import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, merge } from 'rxjs';
import { debounceTime, map, take, filter } from 'rxjs/operators';
import { MessagingService } from './messaging/messaging.service';
import { WebSocketService } from './web-socket.service';

export type ActivityKind =
  | 'start' | 'stop' | 'crash' | 'backup' | 'join' | 'leave' | 'update' | 'error' | 'info' | 'account';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  message: string;
  timestamp: number;
  instanceId?: string;
  /** Who performed the action, when it was a person rather than the server. */
  username?: string | null;
}

/** When this device last looked at the feed. Personal, so it stays on the device. */
export const ACTIVITY_SEEN_KEY = 'cerious-aasm.activity-seen';

/**
 * The "Recent Activity" feed and the bell badge in the top bar.
 *
 * The entries themselves are recorded and kept by the backend, so every client sees the same
 * history and events that happen with no UI open — a scheduled backup, an overnight crash —
 * are still there afterwards. This service just mirrors that list and reloads it when one of
 * the live channels says something happened.
 *
 * Only the "last seen" marker is per device, because whether *you* have read the feed is not
 * shared with anyone else.
 */
@Injectable({ providedIn: 'root' })
export class ActivityService implements OnDestroy {
  private readonly itemsSubject = new BehaviorSubject<ActivityItem[]>([]);
  private readonly lastSeenSubject = new BehaviorSubject<number>(0);
  private readonly subs: Subscription[] = [];

  constructor(private messaging: MessagingService, private webSocket: WebSocketService) {
    this.lastSeenSubject.next(this.readSeen());
    this.refresh();

    // Same as the server list: the first request can be made before the socket is open, so
    // ask again whenever the connection comes up.
    this.subs.push(
      this.webSocket.connected$.pipe(filter((connected: boolean) => connected)).subscribe(() => this.refresh())
    );

    // These are the broadcasts the backend turns into activity entries. Rather than
    // duplicating that classification here, any of them simply prompts a reload; the
    // debounce collapses the bursts that arrive when several servers change at once.
    this.subs.push(
      merge(
        this.messaging.receiveMessage<any>('server-instance-state'),
        this.messaging.receiveMessage<any>('server-instance-players'),
        this.messaging.receiveMessage<any>('backup-created'),
        this.messaging.receiveMessage<any>('notification'),
        this.messaging.receiveMessage<any>('activity-changed'),
        this.messaging.receiveMessage<any>('users-changed')
      ).pipe(debounceTime(400)).subscribe(() => this.refresh())
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub?.unsubscribe?.());
  }

  get items(): ActivityItem[] {
    return this.itemsSubject.value;
  }

  /** Newest first. */
  get items$(): Observable<ActivityItem[]> {
    return this.itemsSubject.asObservable();
  }

  get unreadCount$(): Observable<number> {
    return this.items$.pipe(map(items => items.filter(item => item.timestamp > this.lastSeenSubject.value).length));
  }

  get unreadCount(): number {
    return this.items.filter(item => item.timestamp > this.lastSeenSubject.value).length;
  }

  /** Pull the current feed from the backend. */
  refresh(limit = 100): void {
    this.messaging.sendMessage<any>('get-activity', { limit }).pipe(take(1)).subscribe({
      next: (res) => {
        if (!res || res.success === false || !Array.isArray(res.entries)) return;
        this.itemsSubject.next(res.entries.map((entry: any) => this.toItem(entry)));
      },
      error: () => { /* the feed is a convenience; leave the last list in place */ }
    });
  }

  /** Called when the bell dropdown opens: everything so far has been seen. */
  markAllSeen(): void {
    const now = Date.now();
    this.lastSeenSubject.next(now);
    try {
      localStorage.setItem(ACTIVITY_SEEN_KEY, String(now));
    } catch {
      // storage unavailable; the badge simply resets next load
    }
    // Re-emit so unreadCount$ subscribers recompute.
    this.itemsSubject.next(this.items.slice());
  }

  /** Clear the shared history. Needs the settings permission; refused otherwise. */
  clear(): void {
    this.messaging.sendMessage<any>('clear-activity', {}).pipe(take(1)).subscribe({
      next: () => this.refresh(),
      error: () => { /* the backend reports the refusal through its own notification */ }
    });
  }

  private toItem(entry: any): ActivityItem {
    return {
      id: String(entry.id),
      kind: (entry.kind || 'info') as ActivityKind,
      message: String(entry.message || ''),
      timestamp: Number(entry.createdAt) || Date.now(),
      instanceId: entry.instanceId || undefined,
      username: entry.username || null
    };
  }

  private readSeen(): number {
    try {
      const raw = localStorage.getItem(ACTIVITY_SEEN_KEY);
      const value = raw ? Number(raw) : 0;
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }
}
