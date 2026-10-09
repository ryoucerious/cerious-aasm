import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';

/** Where the latest backup of a server is kept on another machine of the mesh. */
export interface BackupCopy {
  nodeId: string;
  nodeName: string;
  fileName: string;
  size: number;
  copiedAt: number;
}

/** A copy this machine keeps of the latest backup of a server on another machine. */
export interface HeldBackupCopy {
  serverId: string;
  serverName: string;
  fileName: string;
  size: number;
  fromNodeId: string;
  fromNodeName: string;
  copiedAt: number;
}

/** Bringing a backup back, or making a server from one, moves the whole file. */
const COPY_TIMEOUT_MS = 30 * 60_000;

/**
 * The copy of each server's latest backup that another machine of the mesh keeps, so a machine
 * that is lost does not take its servers' backups with it.
 */
@Injectable({ providedIn: 'root' })
export class BackupCopiesService {
  constructor(private messaging: MessagingService) {}

  /** Where the latest backup of a server is kept, asked of the machine hosting it. */
  copyOf(instanceId: string): Observable<{ copy?: BackupCopy | null }> {
    return this.messaging.sendMessage('get-backup-copy', { instanceId });
  }

  /** Into the server's own backups, on the machine hosting it, ready to restore. */
  bringBack(instanceId: string): Observable<{ success?: boolean; error?: string }> {
    return this.messaging.sendMessage('fetch-backup-copy', { instanceId }, { timeoutMs: COPY_TIMEOUT_MS });
  }

  /** The copies this machine keeps for servers on other machines. */
  held(): Observable<{ copies?: HeldBackupCopy[] }> {
    return this.messaging.sendMessage('list-held-backup-copies', {});
  }

  /** A new server on this machine, from the copy it keeps of another machine's server. */
  restore(serverId: string, serverName: string): Observable<{ success?: boolean; error?: string; message?: string }> {
    return this.messaging.sendMessage('restore-backup-copy', { serverId, serverName }, { timeoutMs: COPY_TIMEOUT_MS });
  }
}
