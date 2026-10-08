import { ChangeDetectionStrategy, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { AsyncPipe, NgIf } from '@angular/common';
import { BusyService } from '../../core/services/busy.service';

/**
 * Covers the whole app while something it has to wait for is under way (see BusyService), with
 * a spinner and what it is waiting for. Rendered once by the shell, which also makes the app
 * behind it inert, so the keyboard cannot reach it either.
 */
@Component({
  selector: 'app-busy-overlay',
  standalone: true,
  imports: [NgIf, AsyncPipe],
  template: `
    <div class="busy-overlay" *ngIf="busy.message$ | async as message" role="status" aria-live="polite">
      <div class="busy-overlay-box">
        <span class="material-icons spinner" aria-hidden="true">refresh</span>
        <span>{{ message }}</span>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BusyOverlayComponent implements OnInit, OnDestroy {
  constructor(readonly busy: BusyService, private zone: NgZone) {}

  ngOnInit(): void {
    // On window while it captures, so it comes before the settings drawer and the modals, which
    // close on Escape unless something has already marked it handled.
    this.zone.runOutsideAngular(() => window.addEventListener('keydown', this.onKeydown, true));
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.onKeydown, true);
  }

  private onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.busy.message !== null) event.preventDefault();
  };
}
