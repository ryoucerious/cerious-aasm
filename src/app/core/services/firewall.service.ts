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

export interface FirewallStatus {
  enabled: boolean;
  platform: 'windows' | 'linux' | 'darwin';
  hasAdmin?: boolean;
  /** Present only when the app runs in the Docker image. */
  docker?: DockerNetworkInfo;
}

@Injectable({
  providedIn: 'root'
})
export class FirewallService {
  constructor(private messaging: MessagingService) {}

  /** Whether the host firewall is on, and which platform (and Docker networking) the backend runs on. */
  checkFirewallStatus(): Observable<FirewallStatus> {
    return this.messaging.sendMessage('check-firewall-enabled', {});
  }
}
