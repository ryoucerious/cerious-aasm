import { Injectable } from '@angular/core';
import { Observable, take } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';

export interface FirewallStatus {
  enabled: boolean;
  platform: 'windows' | 'linux' | 'darwin';
  hasAdmin?: boolean;
}

export interface FirewallRule {
  port: number;
  protocol: 'TCP' | 'UDP';
  exists: boolean;
  ruleName?: string;
}

export interface ArkServerFirewallResult {
  success: boolean;
  platform: string;
  rulesCreated?: string[];
  errors?: string[];
  instructions?: string;
  message: string;
}

/**
 * Service for managing Windows/Linux firewall rules for ARK servers and web interface
 */
@Injectable({
  providedIn: 'root'
})
export class FirewallService {
  constructor(private messaging: MessagingService) {}

  /**
   * Check if Windows Firewall is enabled and get platform info
   */
  checkFirewallStatus(): Observable<FirewallStatus> {
    return this.messaging.sendMessage('check-firewall-enabled', {}).pipe(take(1));
  }

  /**
   * Check if user has administrator privileges (Windows only)
   */
  checkAdminPrivileges(): Observable<{ success: boolean; hasAdmin: boolean; error?: string }> {
    return this.messaging.sendMessage('check-admin-privileges', {}).pipe(take(1));
  }

  /**
   * Create application-wide firewall rule (triggers Windows prompt)
   * This allows the entire application to access the network
   */
  createApplicationFirewallRule(): Observable<{ success: boolean; message: string; error?: string }> {
    return this.messaging.sendMessage('create-application-firewall-rule', {}).pipe(take(1));
  }

  /**
   * Setup firewall rules for ARK server (Game + Query + RCON ports)
   */
  setupArkServerFirewall(gamePort: number, queryPort?: number, rconPort?: number, serverName?: string): Observable<ArkServerFirewallResult> {
    return this.messaging.sendMessage('setup-ark-server-firewall', {
      gamePort,
      queryPort,
      rconPort,
      serverName
    }).pipe(take(1));
  }

  /**
   * Setup firewall rule for web server
   */
  setupWebServerFirewall(port: number): Observable<{ success: boolean; platform: string; message: string; error?: string }> {
    return this.messaging.sendMessage('setup-web-server-firewall', { port }).pipe(take(1));
  }

  /**
   * Check if a specific firewall rule exists
   */
  checkFirewallRule(port: number, protocol: 'TCP' | 'UDP' = 'UDP'): Observable<FirewallRule> {
    return this.messaging.sendMessage('check-firewall-rule', { port, protocol }).pipe(take(1));
  }

  /**
   * Remove a specific firewall rule
   */
  removeFirewallRule(port: number, protocol: 'TCP' | 'UDP' = 'UDP'): Observable<{ success: boolean; message: string; error?: string }> {
    return this.messaging.sendMessage('remove-firewall-rule', { port, protocol }).pipe(take(1));
  }

  /**
   * Get existing ARK server firewall rules
   */
  getExistingArkRules(): Observable<{ success: boolean; rules: string[]; error?: string }> {
    return this.messaging.sendMessage('get-existing-ark-rules', {}).pipe(take(1));
  }

  /**
   * Cleanup all ARK server firewall rules
   */
  cleanupArkFirewallRules(): Observable<{ success: boolean; message: string; error?: string }> {
    return this.messaging.sendMessage('cleanup-ark-firewall-rules', {}).pipe(take(1));
  }

  /**
   * Get Linux firewall instructions for manual configuration
   */
  getLinuxFirewallInstructions(gamePort: number, queryPort?: number, rconPort?: number): Observable<{ success: boolean; instructions: string; platform: string; error?: string }> {
    return this.messaging.sendMessage('get-linux-firewall-instructions', {
      gamePort,
      queryPort,
      rconPort
    }).pipe(take(1));
  }

  /**
   * Auto-configure firewall when starting an ARK server
   */
}
