import { execFile } from 'child_process';
import type { ServerPortRanges } from '../utils/ark/port-sets';
import type { PortRange } from '../utils/docker-network.utils';

/**
 * Windows Firewall rules for this machine's server ports.
 *
 * Windows asks about every new program that listens, and every server runs its own copy of
 * ArkAscendedServer.exe, so every new server asked again: on a mesh member nobody may be there to
 * answer. A port rule the admin added is an allow rule that covers any program, so with one in
 * place Windows does not ask. Adding one needs admin, once per machine; reading them does not.
 *
 * A prompt someone cancelled left Block rules for that server's exe, and Block rules win over
 * Allow rules, so opening the ports also clears those for the servers under this app's folder.
 */

export const RULE_GROUP = 'Cerious AASM';

export interface WindowsFirewallStatus {
  /** Windows Firewall is on for at least one network profile. */
  enabled: boolean;
  /** `open`: the app's rules open exactly these ranges. `other`: they open other ports, or one is off. */
  rules: 'open' | 'other' | 'missing';
  /** Server executables a cancelled prompt blocks, as Windows stores them. */
  blockedPrograms: string[];
  /** Players can reach every port in the ranges. */
  portsOpen: boolean;
}

/** The ports this machine listens on for the rest of its mesh, over TCP; null outside a mesh. */
export interface MeshPorts {
  peer: number;
  raft: number;
}

/** Runs a script in Windows PowerShell; `elevated` asks for admin with Windows' own prompt. */
export type PowerShellRunner = (script: string, elevated: boolean) => Promise<{ code: number; stdout: string; stderr: string }>;

/** ERROR_CANCELLED: the admin prompt was declined. */
const DECLINED = 1223;

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
const portsOf = ({ start, end }: PortRange) => (start === end ? `${start}` : `${start}-${end}`);

/** Only the app's own servers: their executables under its folder. */
function serverFilter(root: string): string {
  const folder = root.endsWith('\\') ? root : `${root}\\`;
  return `$root = ${quote(folder)}
$isServer = {
  param($program)
  $p = "$program"
  $p.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (
    $p.EndsWith('\\ArkAscendedServer.exe', [StringComparison]::OrdinalIgnoreCase) -or
    $p.EndsWith('\\AsaApiLoader.exe', [StringComparison]::OrdinalIgnoreCase))
}
$blockRules = {
  Get-NetFirewallApplicationFilter | Where-Object { & $isServer $_.Program } | ForEach-Object {
    $program = "$($_.Program)"
    $_ | Get-NetFirewallRule | Where-Object { "$($_.Action)" -eq 'Block' -and "$($_.Direction)" -eq 'Inbound' } |
      Add-Member -NotePropertyName ServerProgram -NotePropertyValue $program -PassThru
  }
}`;
}

/** Prints the app's port rules, the servers blocked, and whether the firewall is on, as JSON. */
export function buildStatusScript(root: string): string {
  return `$ErrorActionPreference = 'Stop'
${serverFilter(root)}
$rules = @(Get-NetFirewallRule -Group ${quote(RULE_GROUP)} -ErrorAction SilentlyContinue | ForEach-Object {
  $port = $_ | Get-NetFirewallPortFilter
  [pscustomobject]@{
    enabled = "$($_.Enabled)"; action = "$($_.Action)"; direction = "$($_.Direction)"; profile = "$($_.Profile)"
    protocol = "$($port.Protocol)"; ports = (@($port.LocalPort) -join ',')
  }
})
$blocked = @(& $blockRules | Where-Object { "$($_.Enabled)" -eq 'True' } | ForEach-Object { $_.ServerProgram } | Sort-Object -Unique)
$enabled = @(Get-NetFirewallProfile | Where-Object { "$($_.Enabled)" -eq 'True' }).Count -gt 0
[pscustomobject]@{ enabled = $enabled; rules = $rules; blocked = $blocked } | ConvertTo-Json -Depth 4 -Compress`;
}

/**
 * Replaces the app's port rules with ones for `ranges` (and, in a mesh, the mesh's own ports), and
 * clears the servers' Block rules. In a mesh it also clears those on `appPrograms`, the app's own
 * executables the other machines reach, which a cancelled prompt blocks. Run as admin.
 */
export function buildOpenScript(ranges: ServerPortRanges, root: string, mesh: MeshPorts | null = null, appPrograms: string[] = []): string {
  const description = quote('Added by Cerious AASM so players, and the other machines of its mesh, can reach it. Settings > Server Defaults > Server Ports changes them.');
  const allow = (name: string, protocol: 'UDP' | 'TCP', range: PortRange) =>
    `  New-NetFirewallRule -DisplayName ${quote(`${RULE_GROUP}: ${name}`)} -Group ${quote(RULE_GROUP)} -Description ${description} ` +
    `-Direction Inbound -Action Allow -Protocol ${protocol} -LocalPort ${quote(portsOf(range))} -Profile Any | Out-Null`;
  const meshRules = mesh
    ? `\n${allow('mesh connection port', 'TCP', { start: mesh.peer, end: mesh.peer })}\n${allow('mesh database port', 'TCP', { start: mesh.raft, end: mesh.raft })}`
    : '';
  // Matched by exact path: no other program's rules are touched.
  const unblockApp = mesh && appPrograms.length
    ? `\n  $appPrograms = @(${appPrograms.map(quote).join(', ')})
  Get-NetFirewallApplicationFilter | Where-Object { $p = "$($_.Program)"; @($appPrograms | Where-Object { $_ -ieq $p }).Count -gt 0 } |
    Get-NetFirewallRule | Where-Object { "$($_.Action)" -eq 'Block' -and "$($_.Direction)" -eq 'Inbound' } | Remove-NetFirewallRule`
    : '';
  return `$ErrorActionPreference = 'Stop'
try {
${serverFilter(root)}
  Get-NetFirewallRule -Group ${quote(RULE_GROUP)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule
${allow('ARK game ports', 'UDP', ranges.game)}
${allow('ARK query ports', 'UDP', ranges.query)}${meshRules}
  & $blockRules | Where-Object { $_.Action -eq 'Block' } | Remove-NetFirewallRule${unblockApp}
  exit 0
} catch {
  exit 2
}`;
}

type RawRule = { enabled?: string; action?: string; direction?: string; profile?: string; protocol?: string; ports?: string };

const asArray = <T>(value: T | T[] | null | undefined): T[] => (value == null ? [] : Array.isArray(value) ? value : [value]);

export function parseWindowsFirewallStatus(json: string, ranges: ServerPortRanges, mesh: MeshPorts | null = null): WindowsFirewallStatus {
  const raw = JSON.parse(json) as { enabled?: boolean; rules?: RawRule | RawRule[]; blocked?: string | string[] };
  const rules = asArray(raw.rules);
  const blockedPrograms = asArray(raw.blocked).map(String);
  const opens = (range: PortRange, protocol = 'UDP') => rules.some(rule =>
    rule.enabled === 'True' && rule.action === 'Allow' && rule.direction === 'Inbound' && rule.profile === 'Any' &&
    rule.protocol === protocol && rule.ports === portsOf(range));
  const meshOpen = !mesh || (opens({ start: mesh.peer, end: mesh.peer }, 'TCP') && opens({ start: mesh.raft, end: mesh.raft }, 'TCP'));
  const state = !rules.length ? 'missing' : opens(ranges.game) && opens(ranges.query) && meshOpen ? 'open' : 'other';
  const enabled = raw.enabled !== false;
  return { enabled, rules: state, blockedPrograms, portsOpen: !enabled || (state === 'open' && !blockedPrograms.length) };
}

export async function readWindowsFirewall(
  ranges: ServerPortRanges, root: string, run: PowerShellRunner = runPowerShell, mesh: MeshPorts | null = null
): Promise<WindowsFirewallStatus | { error: string }> {
  const result = await run(buildStatusScript(root), false);
  if (result.code !== 0) return { error: `Could not read Windows Firewall: ${result.stderr.trim() || `exit code ${result.code}`}` };
  try {
    return parseWindowsFirewallStatus(result.stdout, ranges, mesh);
  } catch {
    return { error: 'Could not read Windows Firewall: it answered with something other than the rules.' };
  }
}

/** One admin prompt; the rules are read back afterwards, since the elevated script's output cannot be. */
export async function openWindowsFirewall(
  ranges: ServerPortRanges, root: string, run: PowerShellRunner = runPowerShell, mesh: MeshPorts | null = null, appPrograms: string[] = []
): Promise<{ success: true; status: WindowsFirewallStatus } | { success: false; error: string; status?: WindowsFirewallStatus }> {
  const applied = await run(buildOpenScript(ranges, root, mesh, appPrograms), true);
  if (applied.code === DECLINED) return { success: false, error: 'Windows asked for permission and it was not given, so nothing changed.' };
  const status = await readWindowsFirewall(ranges, root, run, mesh);
  if ('error' in status) return { success: false, error: status.error };
  if (status.portsOpen) return { success: true, status };
  return { success: false, error: 'Windows Firewall did not take the rules. A policy set by your organisation can stop it.', status };
}

/**
 * Windows PowerShell with the script encoded on its command line: nothing is written to a file
 * another program could change between the admin prompt and the run.
 */
export const runPowerShell: PowerShellRunner = (script, elevated) => {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const inner = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
  const args = elevated
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `try { $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ${inner.map(quote).join(',')}; exit $p.ExitCode } ` +
      `catch { [Console]::Error.WriteLine($_.Exception.Message); exit ${DECLINED} }`]
    : inner;
  // The admin prompt waits for whoever is at the machine.
  const timeout = elevated ? 5 * 60_000 : 60_000;
  return new Promise(resolve => {
    execFile('powershell.exe', args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr || (error && !stderr ? error.message : '')) });
    });
  });
};
