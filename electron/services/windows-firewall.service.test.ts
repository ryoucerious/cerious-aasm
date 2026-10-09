import {
  buildOpenScript,
  buildStatusScript,
  openWindowsFirewall,
  parseWindowsFirewallStatus,
  readWindowsFirewall,
  type PowerShellRunner
} from './windows-firewall.service';
import { DEFAULT_SERVER_PORT_RANGES } from '../utils/ark/port-sets';

describe('windows-firewall.service', () => {
  const ranges = DEFAULT_SERVER_PORT_RANGES;
  const root = 'C:\\Users\\jared\\AppData\\Roaming\\Cerious AASM';
  const rule = (ports: string, extra: Record<string, unknown> = {}) =>
    ({ enabled: 'True', action: 'Allow', direction: 'Inbound', profile: 'Any', protocol: 'UDP', ports, ...extra });
  const statusJson = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ enabled: true, rules: [rule('7777-7900'), rule('27015-27030')], blocked: [], ...extra });

  describe('parseWindowsFirewallStatus', () => {
    it('is open when both port rules match the ranges', () => {
      expect(parseWindowsFirewallStatus(statusJson(), ranges)).toEqual({ enabled: true, rules: 'open', blockedPrograms: [], portsOpen: true });
    });

    it('is missing when the app has added no rules', () => {
      expect(parseWindowsFirewallStatus(statusJson({ rules: [] }), ranges)).toEqual(expect.objectContaining({ rules: 'missing', portsOpen: false }));
    });

    // Changed ranges, or a rule someone switched off: applying again fixes either.
    it('is other when the rules open different ports, or one is off', () => {
      expect(parseWindowsFirewallStatus(statusJson({ rules: [rule('7777-7800'), rule('27015-27030')] }), ranges).rules).toBe('other');
      expect(parseWindowsFirewallStatus(statusJson({ rules: [rule('7777-7900', { enabled: 'False' }), rule('27015-27030')] }), ranges).rules).toBe('other');
    });

    // PowerShell writes a one-item array as the item itself.
    it('reads a single rule or blocked program written without its array', () => {
      const status = parseWindowsFirewallStatus(JSON.stringify({ enabled: true, rules: rule('7777-7900'), blocked: 'c:\\x\\arkascendedserver.exe' }), ranges);
      expect(status).toEqual({ enabled: true, rules: 'other', blockedPrograms: ['c:\\x\\arkascendedserver.exe'], portsOpen: false });
    });

    // Block rules win over allow rules, so a server a cancelled prompt blocked stays unreachable.
    it('is not open while a cancelled prompt blocks a server, even with the port rules in place', () => {
      expect(parseWindowsFirewallStatus(statusJson({ blocked: ['c:\\x\\arkascendedserver.exe'] }), ranges))
        .toEqual(expect.objectContaining({ rules: 'open', portsOpen: false }));
    });

    it('counts the ports open when Windows Firewall is off', () => {
      expect(parseWindowsFirewallStatus(statusJson({ enabled: false, rules: [] }), ranges)).toEqual(expect.objectContaining({ portsOpen: true }));
    });
  });

  // A machine in a mesh is reached on two ports of its own: a cancelled prompt cut it off.
  describe('in a mesh', () => {
    const mesh = { peer: 4747, raft: 4002 };
    const tcp = (ports: string) => rule(ports, { protocol: 'TCP' });

    it('opens the mesh\'s connection and database ports for TCP as well', () => {
      const script = buildOpenScript(ranges, root, mesh);
      expect(script).toContain("-Protocol TCP -LocalPort '4747' -Profile Any");
      expect(script).toContain("-Protocol TCP -LocalPort '4002' -Profile Any");
    });

    it('is open only when the mesh ports are too', () => {
      expect(parseWindowsFirewallStatus(statusJson(), ranges, mesh).rules).toBe('other');
      expect(parseWindowsFirewallStatus(statusJson({ rules: [rule('7777-7900'), rule('27015-27030'), tcp('4747'), tcp('4002')] }), ranges, mesh).rules).toBe('open');
    });

    it('leaves the mesh ports alone outside a mesh', () => {
      expect(buildOpenScript(ranges, root)).not.toContain('-Protocol TCP');
    });

    // A cancelled prompt for the app or its mesh database blocks the program, and a block beats any allow.
    it("clears the block rules a cancelled prompt left on the app's own programs", () => {
      const script = buildOpenScript(ranges, root, mesh, ['C:\\Program Files\\Cerious AASM\\Cerious AASM.exe', "D:\\Jo's\\rqlited.exe"]);
      expect(script).toContain("$appPrograms = @('C:\\Program Files\\Cerious AASM\\Cerious AASM.exe', 'D:\\Jo''s\\rqlited.exe')");
      expect(script).toMatch(/\$appPrograms[\s\S]*-ieq[\s\S]*'Block'[\s\S]*Remove-NetFirewallRule/);
    });

    it("touches no program's rules but the servers' outside a mesh", () => {
      expect(buildOpenScript(ranges, root, null, ['C:\\x.exe'])).not.toContain('$appPrograms');
    });

    it("hands the app's own programs to the script it runs as admin", async () => {
      const run = jest.fn<ReturnType<PowerShellRunner>, Parameters<PowerShellRunner>>(async () => ({ code: 0, stdout: statusJson(), stderr: '' }));

      await openWindowsFirewall(ranges, root, run, mesh, ['C:\\a.exe']);

      expect(run).toHaveBeenNthCalledWith(1, buildOpenScript(ranges, root, mesh, ['C:\\a.exe']), true);
    });
  });

  describe('the scripts', () => {
    it('opens the game and query ranges for UDP, in every profile, and only those', () => {
      const script = buildOpenScript(ranges, root);
      expect(script).toContain("-Protocol UDP -LocalPort '7777-7900' -Profile Any");
      expect(script).toContain("-Protocol UDP -LocalPort '27015-27030' -Profile Any");
      expect(script).not.toContain('27020-27050');
      expect(script).toContain("Get-NetFirewallRule -Group 'Cerious AASM'");
    });

    it('clears block rules on the servers under this app\'s folder, and nowhere else', () => {
      const script = buildOpenScript(ranges, root);
      expect(script).toContain("$root = 'C:\\Users\\jared\\AppData\\Roaming\\Cerious AASM\\'");
      expect(script).toMatch(/\$_\.Action -eq 'Block'[\s\S]*Remove-NetFirewallRule/);
    });

    it('quotes a folder with an apostrophe in it', () => {
      expect(buildStatusScript("D:\\Jo's Servers")).toContain("$root = 'D:\\Jo''s Servers\\'");
    });
  });

  describe('readWindowsFirewall', () => {
    it('reads without asking for admin', async () => {
      const run = jest.fn<ReturnType<PowerShellRunner>, Parameters<PowerShellRunner>>(async () => ({ code: 0, stdout: statusJson(), stderr: '' }));

      await expect(readWindowsFirewall(ranges, root, run)).resolves.toEqual(expect.objectContaining({ portsOpen: true }));
      expect(run).toHaveBeenCalledWith(buildStatusScript(root), false);
    });

    it('reports when it cannot be read', async () => {
      const run: PowerShellRunner = async () => ({ code: 1, stdout: '', stderr: 'boom' });

      await expect(readWindowsFirewall(ranges, root, run)).resolves.toEqual({ error: 'Could not read Windows Firewall: boom' });
    });
  });

  describe('openWindowsFirewall', () => {
    it('asks for admin once, then checks the rules took', async () => {
      const run = jest.fn<ReturnType<PowerShellRunner>, Parameters<PowerShellRunner>>(async (_script, elevated) =>
        elevated ? { code: 0, stdout: '', stderr: '' } : { code: 0, stdout: statusJson(), stderr: '' });

      await expect(openWindowsFirewall(ranges, root, run)).resolves.toEqual({ success: true, status: expect.objectContaining({ portsOpen: true }) });
      expect(run).toHaveBeenNthCalledWith(1, buildOpenScript(ranges, root), true);
      expect(run).toHaveBeenNthCalledWith(2, buildStatusScript(root), false);
    });

    it('says so when the admin prompt is declined', async () => {
      const run: PowerShellRunner = async () => ({ code: 1223, stdout: '', stderr: 'The operation was canceled by the user.' });

      await expect(openWindowsFirewall(ranges, root, run))
        .resolves.toEqual({ success: false, error: 'Windows asked for permission and it was not given, so nothing changed.' });
    });

    it('fails when the rules are not there afterwards', async () => {
      const run: PowerShellRunner = async (_script, elevated) =>
        elevated ? { code: 2, stdout: '', stderr: '' } : { code: 0, stdout: statusJson({ rules: [] }), stderr: '' };

      await expect(openWindowsFirewall(ranges, root, run)).resolves.toEqual({
        success: false,
        error: 'Windows Firewall did not take the rules. A policy set by your organisation can stop it.',
        status: expect.objectContaining({ rules: 'missing' })
      });
    });
  });
});
