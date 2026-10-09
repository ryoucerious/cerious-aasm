import { parseServerPortRanges, portsOutsideRanges, type PortCarrier, type PortOutsideRange, type ServerPortRanges } from '../utils/ark/port-sets';
import { getAllInstances } from '../utils/ark/instance.utils';
import { getDockerNetworkInfo, type DockerNetworkInfo } from '../utils/docker-network.utils';
import { getLinuxServerPortsInstructions } from '../utils/firewall.utils';
import { loadGlobalConfig, saveGlobalConfig, type GlobalConfig } from '../utils/global-config.utils';
import { getDefaultInstallDir, getPlatform } from '../utils/platform.utils';
import { getServerPortRanges, type ServerPortsSource } from '../utils/server-ports.utils';
import { openWindowsFirewall, readWindowsFirewall, type MeshPorts, type WindowsFirewallStatus } from './windows-firewall.service';
import { meshListenPorts } from './mesh/mesh-hooks';
import { findRqliteBinary } from './mesh/rqlite-supervisor';

/** What Settings → Server Defaults → Server Ports shows for this machine. */
export interface ServerPortsState {
  ranges: ServerPortRanges;
  source: ServerPortsSource;
  platform: 'windows' | 'linux';
  /** Windows, outside Docker: how Windows Firewall stands for the ranges. Null elsewhere, or unread. */
  windowsFirewall: WindowsFirewallStatus | null;
  windowsFirewallError?: string;
  /** Linux, outside Docker: the commands that open the ranges. */
  linuxCommands: string | null;
  /** Servers here with ports outside the ranges, which players cannot reach through the firewall. */
  outside: Array<{ id: string; name: string; ports: PortOutsideRange[] }>;
  /** In a mesh: the ports the other machines reach this one on, opened with the server ports. */
  meshPorts: MeshPorts | null;
}

export interface ServerPortsDeps {
  platform(): 'windows' | 'linux';
  docker(): DockerNetworkInfo | null;
  loadConfig(): GlobalConfig;
  saveConfig(config: GlobalConfig): boolean;
  instances(): Promise<Array<{ id: string; name?: string } & PortCarrier>>;
  /** The folder the servers live under: whose executables a cancelled prompt may have blocked. */
  root(): string;
  readFirewall(ranges: ServerPortRanges, root: string, mesh: MeshPorts | null): ReturnType<typeof readWindowsFirewall>;
  openFirewall(ranges: ServerPortRanges, root: string, mesh: MeshPorts | null): ReturnType<typeof openWindowsFirewall>;
  now(): number;
  /** The ports this machine listens on for its mesh, or null outside one. */
  meshPorts(): MeshPorts | null;
}

const defaultDeps: ServerPortsDeps = {
  platform: getPlatform,
  docker: () => getDockerNetworkInfo(),
  loadConfig: loadGlobalConfig,
  saveConfig: saveGlobalConfig,
  instances: getAllInstances,
  root: () => loadGlobalConfig().serverDataDir || getDefaultInstallDir(),
  readFirewall: (ranges, root, mesh) => readWindowsFirewall(ranges, root, undefined, mesh),
  // In a mesh, the app and its mesh database are what the other machines reach.
  openFirewall: (ranges, root, mesh) => openWindowsFirewall(ranges, root, undefined, mesh, mesh ? appPrograms() : []),
  now: () => Date.now(),
  meshPorts: meshListenPorts
};

/** This app's executable and its mesh database's: Windows' prompt asks about each by program. */
function appPrograms(): string[] {
  return [process.execPath, findRqliteBinary()].filter((program): program is string => !!program);
}

/** Windows Firewall is read again after this long, for the mesh heartbeat. */
const FIREWALL_STALE_MS = 10 * 60_000;

/**
 * The ranges this machine's servers take their ports from, and whether its firewall lets players
 * reach them: Windows Firewall rules the app adds with one admin prompt, ufw or firewalld commands
 * on Linux, or what docker-compose.yml publishes.
 */
export class ServerPortsService {
  private lastRead: { key: string; portsOpen: boolean; at: number } | null = null;
  private reading: Promise<unknown> | null = null;

  constructor(private deps: ServerPortsDeps = defaultDeps) {}

  private ranges(): { ranges: ServerPortRanges; source: ServerPortsSource } {
    return getServerPortRanges(this.deps.loadConfig(), this.deps.docker());
  }

  private usesWindowsFirewall(): boolean {
    return this.deps.platform() === 'windows' && !this.deps.docker();
  }

  /** What the firewall has to open: the server ports, and the mesh's own in a mesh. */
  private openingKey(ranges: ServerPortRanges): string {
    return JSON.stringify([ranges, this.deps.meshPorts()]);
  }

  private async readFirewall(ranges: ServerPortRanges): Promise<WindowsFirewallStatus | { error: string }> {
    const status = await this.deps.readFirewall(ranges, this.deps.root(), this.deps.meshPorts());
    if (!('error' in status)) this.lastRead = { key: this.openingKey(ranges), portsOpen: status.portsOpen, at: this.deps.now() };
    return status;
  }

  async state(): Promise<ServerPortsState> {
    const { ranges, source } = this.ranges();
    const platform = this.deps.platform();
    const docker = !!this.deps.docker();
    const firewall = this.usesWindowsFirewall() ? await this.readFirewall(ranges) : null;
    const outside = (await this.deps.instances())
      .map(instance => ({ id: instance.id, name: instance.name || instance.id, ports: portsOutsideRanges(instance, ranges) }))
      .filter(server => server.ports.length > 0);
    return {
      ranges,
      source,
      platform,
      windowsFirewall: firewall && !('error' in firewall) ? firewall : null,
      ...(firewall && 'error' in firewall ? { windowsFirewallError: firewall.error } : {}),
      linuxCommands: platform === 'linux' && !docker ? getLinuxServerPortsInstructions(ranges) : null,
      outside,
      meshPorts: this.deps.meshPorts()
    };
  }

  async setRanges(input: unknown): Promise<{ success: true; state: ServerPortsState } | { success: false; error: string }> {
    if (this.deps.docker()) {
      return { success: false, error: 'In Docker these come from docker-compose.yml: set AASM_GAME_PORTS, AASM_QUERY_PORTS and AASM_RCON_PORTS there.' };
    }
    const parsed = parseServerPortRanges(input);
    if ('error' in parsed) return { success: false, error: parsed.error };
    if (!this.deps.saveConfig({ ...this.deps.loadConfig(), serverPorts: parsed.ranges })) {
      return { success: false, error: 'Could not save the server ports.' };
    }
    return { success: true, state: await this.state() };
  }

  async openFirewall(): Promise<{ success: boolean; error?: string; state?: ServerPortsState }> {
    if (!this.usesWindowsFirewall()) {
      return { success: false, error: 'Only Windows can open its firewall from here. On Linux, run the commands shown.' };
    }
    const result = await this.deps.openFirewall(this.ranges().ranges, this.deps.root(), this.deps.meshPorts());
    const state = await this.state();
    return result.success ? { success: true, state } : { success: false, error: result.error, state };
  }

  /**
   * Whether players can reach this machine's server ports, for the mesh heartbeat: null away from
   * Windows, or until Windows Firewall has been read. Never waits; a stale answer is read again in
   * the background.
   */
  portsOpen(): boolean | null {
    if (!this.usesWindowsFirewall()) return null;
    const { ranges } = this.ranges();
    const key = this.openingKey(ranges);
    const current = this.lastRead?.key === key ? this.lastRead : null;
    if ((!current || this.deps.now() - current.at > FIREWALL_STALE_MS) && !this.reading) {
      this.reading = this.readFirewall(ranges)
        .catch(error => console.warn('[server-ports] Could not read Windows Firewall:', error instanceof Error ? error.message : error))
        .finally(() => { this.reading = null; });
    }
    return current ? current.portsOpen : null;
  }
}

export const serverPortsService = new ServerPortsService();
