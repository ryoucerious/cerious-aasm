import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';

export interface AppUpdateStatus {
  status: 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';
  version?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  releaseNotes?: string;
  releaseDate?: string;
  error?: string;
  /** Set when this client must be updated outside the app. */
  manual?: boolean;
  /** How to apply the update. Shown instead of downloading. */
  instructions?: string;
  instructionsUrl?: string;
}

/**
 * Whether a new version of the app itself is waiting.
 *
 * The sidebar version mark is the place to download and install it. This keeps that state
 * in one subscription so a late listener still sees an update found before it loaded.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly statusSubject = new BehaviorSubject<AppUpdateStatus | null>(null);

  constructor(private messaging: MessagingService) {
    this.messaging.receiveMessage<AppUpdateStatus>('app-update-status').subscribe(status => {
      if (status) this.statusSubject.next(status);
    });
    // The main process may have found the update before the UI was listening.
    this.messaging.sendNotification('get-app-update-status', {});
  }

  get status$(): Observable<AppUpdateStatus | null> {
    return this.statusSubject.asObservable();
  }

  get status(): AppUpdateStatus | null {
    return this.statusSubject.value;
  }

  /** True from the moment an update is found until it has been installed. */
  static isPending(status: AppUpdateStatus | null): boolean {
    return status?.status === 'available'
      || status?.status === 'downloading'
      || status?.status === 'downloaded'
      || status?.status === 'error';
  }

  download(): void {
    this.messaging.sendNotification('download-app-update', {});
  }

  install(): void {
    this.messaging.sendNotification('install-app-update', {});
  }
}
