import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';

export interface PortRange {
  start: number;
  end: number;
}

/** How the Docker image is networked. Mirrors DockerNetworkInfo in electron/utils/docker-network.utils.ts. */
export interface DockerNetworkInfo {
  /** `published`: only the compose port ranges reach the container. `host`: it shares the host network. */
  mode: 'published' | 'host';
  gamePorts: PortRange;
  queryPorts: PortRange;
  rconPorts: PortRange;
  webPort: number;
}

/** Where a machine's servers take their ports from. Game covers the peer port (game + 1) too. */
export interface ServerPortRanges {
  game: PortRange;
  query: PortRange;
  rcon: PortRange;
}

export interface FirewallStatus {
  enabled: boolean;
  platform: 'windows' | 'linux' | 'darwin';
  hasAdmin?: boolean;
  /** Present only when the app runs in the Docker image. */
  docker?: DockerNetworkInfo;
  /**
   * This machine's server ports: set in Settings, or by docker-compose.yml in Docker. portsOpen is
   * whether Windows Firewall lets players reach them; null where that is not known.
   */
  serverPorts?: { ranges: ServerPortRanges; source: 'docker' | 'settings'; portsOpen: boolean | null };
}

/** How Windows Firewall stands for a machine's server ports. Mirrors electron/services/windows-firewall.service.ts. */
export interface WindowsFirewallStatus {
  enabled: boolean;
  rules: 'open' | 'other' | 'missing';
  /** Server executables a cancelled Windows prompt blocks. */
  blockedPrograms: string[];
  portsOpen: boolean;
}

/** A port of a server outside the range it has to be in. */
export interface PortOutsideRange {
  label: 'Game' | 'Peer' | 'Query' | 'RCON';
  port: number;
  protocol: 'UDP' | 'TCP';
  range: PortRange;
}

/** Settings → Server ports. Mirrors ServerPortsState in electron/services/server-ports.service.ts. */
export interface ServerPortsState {
  ranges: ServerPortRanges;
  source: 'docker' | 'settings';
  platform: 'windows' | 'linux';
  windowsFirewall: WindowsFirewallStatus | null;
  windowsFirewallError?: string;
  linuxCommands: string | null;
  outside: Array<{ id: string; name: string; ports: PortOutsideRange[] }>;
}

export interface ServerPortsReply {
  success: boolean;
  error?: string;
  state?: ServerPortsState;
}

/** Windows' admin prompt waits for whoever is at the machine. */
const OPEN_FIREWALL_TIMEOUT_MS = 5 * 60_000;

@Injectable({
  providedIn: 'root'
})
export class FirewallService {
  constructor(private messaging: MessagingService) {}

  /** Whether the host firewall is on, and which platform (and Docker networking) the backend runs on. */
  checkFirewallStatus(): Observable<FirewallStatus> {
    return this.messaging.sendMessage('check-firewall-enabled', {});
  }

  /** This machine's server ports, and whether its firewall lets players reach them. */
  getServerPorts(): Observable<ServerPortsState> {
    return this.messaging.sendMessage('get-server-ports', {});
  }

  setServerPorts(ranges: ServerPortRanges): Observable<ServerPortsReply> {
    return this.messaging.sendMessage('set-server-ports', { ranges });
  }

  /** Windows only, from the desktop app: one admin prompt, on this machine's screen. */
  openServerPortsFirewall(): Observable<ServerPortsReply> {
    return this.messaging.sendMessage('open-server-ports-firewall', {}, { timeoutMs: OPEN_FIREWALL_TIMEOUT_MS });
  }
}
