import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { NgIf } from '@angular/common';

let nextTitleId = 0;

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [NgIf],
  templateUrl: './modal.component.html'
})
export class ModalComponent {
  @Input() title: string = '';
  @Input() show = false;
  @Input() maxWidth: string = '';
  /** Escape or a click on the backdrop. The host decides whether that dismisses anything. */
  @Output() close = new EventEmitter<void>();

  readonly titleId = `modal-title-${++nextTitleId}`;
  private pressStartedOnBackdrop = false;

  // An Escape already handled inside (an open dropdown closing itself) is left alone; the one
  // handled here is marked so the settings drawer underneath stays open.
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (!this.show || event.defaultPrevented) return;
    event.preventDefault();
    this.close.emit();
  }

  onBackdropMousedown(event: MouseEvent): void {
    this.pressStartedOnBackdrop = event.target === event.currentTarget;
  }

  // Both ends of the click must be on the backdrop: a text selection dragged out of a field and
  // released over it is not a request to close.
  onBackdropClick(event: MouseEvent): void {
    const onBackdrop = this.pressStartedOnBackdrop && event.target === event.currentTarget;
    this.pressStartedOnBackdrop = false;
    if (onBackdrop) this.close.emit();
  }
}
