import { Injectable } from '@angular/core';
import { MessagingService } from './messaging/messaging.service';
import { ToastService } from './toast.service';
import { Subscription } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private subs: Subscription[] = [];

  constructor(
    private messaging: MessagingService,
    private toast: ToastService
  ) {
    // Listen for info messages from backend and show as toast
    this.subs.push(this.messaging.receiveMessage<any>('notification').subscribe(notification => {
      if (!notification || !notification.type || !notification.message) return;
      switch (notification.type) {
        case 'success':
          this.success(notification.message);
          break;
        case 'error':
          this.error(notification.message);
          break;
        case 'info':
          this.info(notification.message);
          break;
        case 'warning':
          this.warning(notification.message);
          break;
        default:
          this.info(notification.message);
      }
    }));
  }

  ngOnDestroy() {
    this.subs.forEach(sub => sub.unsubscribe());
  }

  success(message: string, title?: string, timeOut: number = 3000) {
    this.toast.success(message, title, timeOut);
  }
  error(message: string, title?: string, timeOut: number = 3000) {
    this.toast.error(message, title, timeOut);
  }
  info(message: string, title?: string, timeOut: number = 3000) {
    this.toast.info(message, title, timeOut);
  }
  warning(message: string, title?: string, timeOut: number = 3000) {
    this.toast.warning(message, title, timeOut);
  }
}
