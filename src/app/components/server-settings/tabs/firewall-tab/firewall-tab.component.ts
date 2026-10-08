import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DockerNetworkInfo, FirewallStatus, PortRange, ServerPortRanges } from '../../../../core/services/firewall.service';
import { ServerInstance } from '../../../../core/models/server-instance.model';
import { MeshNodesService } from '../../../../core/services/mesh-nodes.service';

/** One port this server uses, checked against the range Docker publishes for it. */
export interface DockerPortCheck {
  label: string;
  port: number;
  protocol: 'UDP' | 'TCP';
  range: PortRange;
  ok: boolean;
}

@Component({
  selector: 'app-firewall-tab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './firewall-tab.component.html',
  styleUrls: ['./firewall-tab.component.scss']
})
export class FirewallTabComponent {
  @Input() serverInstance: Partial<ServerInstance> = {};
  /** Carries `docker` when the app runs in the Docker image, which changes the whole page. */
  @Input() firewallStatus: FirewallStatus | null = null;

  constructor(private meshNodes: MeshNodesService) {}

  /** The machine the server runs on, when that is another one of the mesh; null for this one. */
  get otherMachine(): string | null {
    const nodeId = this.serverInstance.nodeId;
    if (this.meshNodes.isHere(nodeId)) return null;
    return this.meshNodes.serverPortsOf(String(nodeId))?.name || this.meshNodes.nameOf(nodeId) || 'another machine';
  }

  /** "this machine's" or "asa-1's": whose server ports the page is about. */
  get machineLabel(): string {
    const other = this.otherMachine;
    return other ? `${other}'s` : 'this machine\'s';
  }

  /**
   * The ranges the server's machine takes ports from, and whether its firewall lets players in:
   * from this machine, or from the heartbeat of the one hosting it.
   */
  get machinePorts(): { ranges: ServerPortRanges; portsOpen: boolean | null } | null {
    const nodeId = this.serverInstance.nodeId;
    if (this.meshNodes.isHere(nodeId)) return this.firewallStatus?.serverPorts ?? null;
    return this.meshNodes.serverPortsOf(String(nodeId));
  }

  /** Whether Windows Firewall lets players reach the ranges; null where that is not known. */
  get portsOpen(): boolean | null {
    return this.machinePorts?.portsOpen ?? null;
  }

  /** ufw and firewalld commands: for a Linux machine, this one, outside Docker's published ports. */
  get showLinuxCommands(): boolean {
    return !this.dockerPublished && !this.otherMachine && this.firewallStatus?.platform !== 'windows';
  }

  get platformLabel(): string {
    if (this.otherMachine) return `On ${this.otherMachine}`;
    if (this.dockerPublished) return 'Linux (Docker)';
    if (this.dockerHost) return 'Linux (Docker, Host Networking)';
    return this.firewallStatus?.platform === 'windows' ? 'Windows' : 'Linux';
  }

  get statusLabel(): string {
    if (this.dockerPublished && !this.otherMachine) return 'Managed by Docker';
    if (this.portsOpen === true) return 'Open';
    if (this.portsOpen === false) return 'Blocked by Windows Firewall';
    return 'Manual Configuration Required';
  }

  get docker(): DockerNetworkInfo | null {
    return this.firewallStatus?.docker ?? null;
  }

  get dockerPublished(): boolean {
    return this.docker?.mode === 'published';
  }

  get dockerHost(): boolean {
    return this.docker?.mode === 'host';
  }

  get gamePort(): number {
    return parseInt(String(this.serverInstance.gamePort), 10) || 7777;
  }

  /** Steam's peer port: always the game port + 1, never a setting of its own. */
  get peerPort(): number {
    return this.gamePort + 1;
  }

  /**
   * Every port this server listens on, against the range it has to fall in: what Docker
   * publishes, or the server ports of the machine it runs on, which its firewall opens.
   * The peer port is not a setting of its own (it is always the game port + 1), so a game
   * port at the top of the range quietly puts the peer port outside it.
   */
  get portChecks(): DockerPortCheck[] {
    const docker = this.docker && !this.otherMachine
      ? this.docker
      : this.machinePorts
        ? { gamePorts: this.machinePorts.ranges.game, queryPorts: this.machinePorts.ranges.query, rconPorts: this.machinePorts.ranges.rcon }
        : null;
    if (!docker) return [];
    const toPort = (value: unknown) => parseInt(String(value), 10);
    const gamePort = toPort(this.serverInstance.gamePort) || 7777;
    const checks: Omit<DockerPortCheck, 'ok'>[] = [
      { label: 'Game', port: gamePort, protocol: 'UDP', range: docker.gamePorts },
      { label: 'Peer', port: gamePort + 1, protocol: 'UDP', range: docker.gamePorts }
    ];
    const queryPort = toPort(this.serverInstance.queryPort);
    if (queryPort) checks.push({ label: 'Query', port: queryPort, protocol: 'UDP', range: docker.queryPorts });
    const rconPort = toPort(this.serverInstance.rconPort);
    if (rconPort) checks.push({ label: 'RCON', port: rconPort, protocol: 'TCP', range: docker.rconPorts });
    return checks.map(check => ({ ...check, ok: check.port >= check.range.start && check.port <= check.range.end }));
  }

  get portsOutOfRange(): number {
    return this.portChecks.filter(check => !check.ok).length;
  }

  formatRange(range: PortRange): string {
    return range.start === range.end ? `${range.start}` : `${range.start}–${range.end}`;
  }

  /** The same range in Compose/ufw syntax, which takes a plain hyphen or colon rather than an en dash. */
  composeRange(range: PortRange): string {
    return range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`;
  }
}
