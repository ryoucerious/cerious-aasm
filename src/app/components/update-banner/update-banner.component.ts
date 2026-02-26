import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { NgIf } from '@angular/common';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { Subscription } from 'rxjs';

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
}

@Component({
  selector: 'app-update-banner',
  standalone: true,
  imports: [NgIf],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './update-banner.component.html',
  styleUrls: ['./update-banner.component.scss']
})
export class UpdateBannerComponent implements OnInit, OnDestroy {
  updateStatus: AppUpdateStatus | null = null;
  dismissed = false;
  private sub!: Subscription;

  constructor(
    private messaging: MessagingService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.messaging.receiveMessage<AppUpdateStatus>('app-update-status').subscribe(status => {
      if (!status) return;
      this.updateStatus = status;
      // Un-dismiss when going from downloading → downloaded so the user sees the prompt
      if (status.status === 'downloaded') {
        this.dismissed = false;
      }
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  get downloadPercent(): number {
    return Math.round(this.updateStatus?.percent ?? 0);
  }

  dismiss(): void {
    this.dismissed = true;
    this.cdr.markForCheck();
  }

  installUpdate(): void {
    this.messaging.sendNotification('install-app-update', {});
  }
}
