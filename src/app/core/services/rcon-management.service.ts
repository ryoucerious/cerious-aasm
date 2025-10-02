import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';

@Injectable({
  providedIn: 'root'
})
export class RconManagementService {
  
  readonly knownRconCommands: string[] = [
    'ListPlayers',
    'SaveWorld',
    'DoExit',
    'ServerChat <message>',
    'KickPlayer <PlayerID>',
    'BanPlayer <PlayerID>'
  ];

  constructor(private messaging: MessagingService) {}

  /**
   * Send an RCON command to the specified server
   */
  sendRconCommand(serverId: string, command: string): Observable<any> {
    if (!command?.trim() || !serverId) {
      throw new Error('Server ID and command are required');
    }

    return this.messaging.sendMessage('rcon-command', {
      id: serverId,
      command: command
    });
  }

  /**
   * Get the list of known RCON commands for UI suggestions
   */
  getKnownCommands(): string[] {
    return [...this.knownRconCommands];
  }

  /**
   * Validate if a command is non-empty and properly formatted
   */
  isValidCommand(command: string): boolean {
    return !!(command && command.trim().length > 0);
  }

  /**
   * Subscribe to RCON status updates
   */
  subscribeToRconStatus(): Observable<any> {
    return this.messaging.receiveMessage('rcon-status');
  }
}