import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { MessagingService } from './messaging/messaging.service';

interface BackendNotification {
  /** success, error or warning; anything else shows as info. */
  type?: string;
  message?: string;
}

/** Toasts, including every notification the backend broadcasts. */
@Injectable({ providedIn: 'root' })
export class NotificationService implements OnDestroy {
  private subs: Subscription[] = [];

  constructor(
    private messaging: MessagingService,
    private toastr: ToastrService
  ) {
    this.subs.push(this.messaging.receiveMessage<BackendNotification>('notification').subscribe(notification => {
      if (!notification?.type || !notification.message) return;
      switch (notification.type) {
        case 'success':
          this.success(notification.message);
          break;
        case 'error':
          this.error(notification.message);
          break;
        case 'warning':
          this.warning(notification.message);
          break;
        default:
          this.info(notification.message);
      }
    }));
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub.unsubscribe());
  }

  success(message: string, title?: string, timeOut: number = 3000): void {
    this.toastr.success(message, title, { timeOut });
  }

  error(message: string, title?: string, timeOut: number = 3000): void {
    this.toastr.error(message, title, { timeOut });
  }

  info(message: string, title?: string, timeOut: number = 3000): void {
    this.toastr.info(message, title, { timeOut });
  }

  warning(message: string, title?: string, timeOut: number = 3000): void {
    this.toastr.warning(message, title, { timeOut });
  }
}
