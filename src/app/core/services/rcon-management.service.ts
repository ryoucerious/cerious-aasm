import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';
import { RconStatusEvent } from '../models/server-instance.model';

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

  /** Throws synchronously when either argument is empty. The reply carries the server's response text. */
  sendRconCommand(serverId: string, command: string): Observable<any> {
    if (!command?.trim() || !serverId) {
      throw new Error('Server ID and command are required');
    }

    return this.messaging.sendMessage('rcon-command', {
      id: serverId,
      command: command
    });
  }

  /** Suggestions for the console input. */
  getKnownCommands(): string[] {
    return [...this.knownRconCommands];
  }

  subscribeToRconStatus(): Observable<RconStatusEvent> {
    return this.messaging.receiveMessage<RconStatusEvent>('rcon-status');
  }
}
