import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { NgIf } from '@angular/common';
import { Subscription } from 'rxjs';
import { WindowService } from '../../core/services/window.service';

/**
 * Minimise / maximise / close for the frameless desktop window, drawn to match the app
 * rather than the OS. Renders nothing in the web UI, where there is no window to control.
 */
@Component({
  selector: 'app-window-controls',
  standalone: true,
  imports: [NgIf],
  template: `
    <div class="window-controls" *ngIf="available">
      <button type="button" class="window-control" (click)="minimize()" title="Minimize" aria-label="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" stroke-width="1" /></svg>
      </button>
      <button type="button" class="window-control" (click)="toggleMaximize()"
              [title]="maximized ? 'Restore' : 'Maximize'" [attr.aria-label]="maximized ? 'Restore' : 'Maximize'">
        <svg *ngIf="!maximized" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
        <svg *ngIf="maximized" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" />
          <path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button type="button" class="window-control close" (click)="close()" title="Close" aria-label="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WindowControlsComponent implements OnInit, OnDestroy {
  available = false;
  maximized = false;
  private sub?: Subscription;

  constructor(private windowService: WindowService, private cdr: ChangeDetectorRef) {
    this.available = this.windowService.isAvailable;
  }

  ngOnInit(): void {
    this.sub = this.windowService.isMaximized$.subscribe(maximized => {
      this.maximized = maximized;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  minimize(): void {
    this.windowService.minimize();
  }

  toggleMaximize(): void {
    this.windowService.toggleMaximize();
  }

  close(): void {
    this.windowService.close();
  }
}
