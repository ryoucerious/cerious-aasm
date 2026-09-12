import {
  Component, Input, Output, EventEmitter, HostListener,
  ChangeDetectionStrategy, OnChanges, SimpleChanges
} from '@angular/core';
import { NgIf } from '@angular/common';

/**
 * A panel that slides in from the right over the current page, with a dimmed backdrop.
 *
 * Used for things that are app-wide rather than part of the page you are on — settings,
 * user management — so opening one does not take you away from the server you were looking at.
 * Closes on Escape or a backdrop click; the body is only rendered while open.
 */
@Component({
  selector: 'app-drawer',
  standalone: true,
  imports: [NgIf],
  templateUrl: './drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DrawerComponent implements OnChanges {
  @Input() open = false;
  @Input() title = '';
  @Input() subtitle = '';
  /** Icon shown beside the title. */
  @Input() icon = '';
  /** 'wide' suits a rail plus content; 'narrow' suits a single column. */
  @Input() size: 'narrow' | 'wide' = 'wide';
  @Output() closed = new EventEmitter<void>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']) {
      // Stop the page underneath from scrolling while the drawer has the screen.
      this.setBodyScrollLock(this.open);
    }
  }

  close(): void {
    if (!this.open) return;
    this.setBodyScrollLock(false);
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  private setBodyScrollLock(locked: boolean): void {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('drawer-open', locked);
  }
}
