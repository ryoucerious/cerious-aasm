import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';
import { AppUpdateStatus } from '../../components/update-banner/update-banner.component';

/**
 * Whether a new version of the app itself is waiting.
 *
 * The banner across the top is the place to act on it; this exists so anything else that
 * wants to show it — the version in the sidebar, for one — reads the same state instead of
 * opening its own subscription and missing the message that arrived before it loaded.
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
      || status?.status === 'downloaded';
  }
}
