import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DockerNetworkInfo, FirewallStatus, PortRange } from '../../../../core/services/firewall.service';
import { ServerInstance } from '../../../../core/models/server-instance.model';

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

  get docker(): DockerNetworkInfo | null {
    return this.firewallStatus?.docker ?? null;
  }

  get dockerPublished(): boolean {
    return this.docker?.mode === 'published';
  }

  get dockerHost(): boolean {
    return this.docker?.mode === 'host';
  }

  /**
   * Every port this server listens on, against the published range it has to fall in.
   * The peer port is not a setting of its own (it is always the game port + 1), so a game
   * port at the top of the range quietly puts the peer port outside it.
   */
  get portChecks(): DockerPortCheck[] {
    const docker = this.docker;
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
