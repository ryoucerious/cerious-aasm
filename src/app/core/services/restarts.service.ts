import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { DEFAULT_REQUEST_TIMEOUT_MS, MessagingService } from './messaging/messaging.service';
import { NotificationService } from './notification.service';
import { STOP_TIMEOUT_MS } from './server-lifecycle.service';

interface PendingChange {
  instanceId?: string;
  dueAt?: number | null;
  all?: boolean;
}

type ServerRef = { id: string; name?: string };
type Reply = { success?: boolean; error?: string } | null | undefined;

/** A restart now stops the server, which can take minutes, then starts it. */
const RESTART_NOW_TIMEOUT_MS = STOP_TIMEOUT_MS + 60_000;

/**
 * Restarts asked for from the app: a server's own, or every server's. With minutes of warning the
 * players hear the countdown a scheduled restart gives them, and it can be cancelled until it ends.
 * Follows each countdown, here and on the other machines of a mesh, so pages can show it.
 */
@Injectable({ providedIn: 'root' })
export class RestartsService implements OnDestroy {
  private readonly pending = new Map<string, { dueAt: number; all: boolean }>();
  private readonly changes = new BehaviorSubject<void>(undefined);
  private readonly subs = new Subscription();

  constructor(private messaging: MessagingService, private notification: NotificationService) {
    this.subs.add(this.messaging.receiveMessage<PendingChange>('server-restart-pending').subscribe(change => this.apply(change)));
    this.subs.add(this.messaging.sendMessage<{ pending?: PendingChange[] }>('get-pending-restarts', {}).subscribe({
      next: reply => (reply?.pending || []).forEach(change => this.apply(change)),
      error: () => { /* none known until one starts */ }
    }));
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  get changed$(): Observable<void> {
    return this.changes.asObservable();
  }

  /** When a server's restart is due, or null when none is counting down. */
  dueAt(id: string | null | undefined): number | null {
    return (id && this.pending.get(id)?.dueAt) || null;
  }

  /** When the soonest restart of all servers is due, or null when none is counting down. */
  restartingAllAt(): number | null {
    const due = [...this.pending.values()].filter(entry => entry.all).map(entry => entry.dueAt);
    return due.length ? Math.min(...due) : null;
  }

  restart(server: ServerRef, warningMinutes: number): void {
    const timeoutMs = warningMinutes ? DEFAULT_REQUEST_TIMEOUT_MS : RESTART_NOW_TIMEOUT_MS;
    this.send('restart-server-instance', { id: server.id, warningMinutes }, `Could not restart ${server.name || server.id}.`, timeoutMs);
  }

  cancel(server: ServerRef): void {
    this.send('cancel-server-restart', { id: server.id }, `Could not cancel the restart of ${server.name || server.id}.`);
  }

  restartAll(warningMinutes: number): void {
    this.send('restart-all-instances', { warningMinutes }, 'Could not restart the servers.', RESTART_NOW_TIMEOUT_MS);
  }

  cancelAll(): void {
    this.send('cancel-restart-all', {}, 'Could not cancel the restart.');
  }

  private send(channel: string, payload: Record<string, unknown>, failure: string, timeoutMs?: number): void {
    const request = timeoutMs === undefined
      ? this.messaging.sendMessage<Reply>(channel, payload)
      : this.messaging.sendMessage<Reply>(channel, payload, { timeoutMs });
    request.subscribe({
      next: reply => {
        if (reply && reply.success === false) this.notification.error(reply.error || failure, 'Server Control');
      },
      error: () => this.notification.error(failure, 'Server Control')
    });
  }

  private apply(change: PendingChange | null | undefined): void {
    if (!change?.instanceId) return;
    if (typeof change.dueAt === 'number') this.pending.set(change.instanceId, { dueAt: change.dueAt, all: !!change.all });
    else this.pending.delete(change.instanceId);
    this.changes.next();
  }
}
