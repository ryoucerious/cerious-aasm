import { Component, ChangeDetectionStrategy, ChangeDetectorRef, NgZone, OnDestroy, OnInit } from '@angular/core';
import { NgIf } from '@angular/common';

/** How long the pointer has to rest on something before its tooltip appears. */
const OPEN_DELAY_MS = 400;
/** Gap between the element and the bubble, leaving room for the arrow. */
const OFFSET_PX = 8;
/** Keep the bubble this far from the edges of the window. */
const EDGE_PX = 8;

/**
 * The app's tooltip, shown in place of the browser's own.
 *
 * Rendered once by the shell and driven by document-level listeners rather than a directive
 * on every element, so all the `title` attributes already scattered through the templates
 * get the styled bubble without each component having to opt in. The title is moved off the
 * element while it is hovered, which is what suppresses the native tooltip; the accessible
 * name is preserved as an aria-label.
 */
@Component({
  selector: 'app-tooltip-host',
  standalone: true,
  imports: [NgIf],
  template: `
    <div class="tooltip-bubble" *ngIf="text" [class.below]="below" [class.visible]="visible"
         role="tooltip" [style.left.px]="left" [style.top.px]="top">{{ text }}</div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TooltipHostComponent implements OnInit, OnDestroy {
  text = '';
  left = 0;
  top = 0;
  /** True when there was no room above and the bubble sits under the element instead. */
  below = false;
  /** Set a frame after mounting so the bubble can fade in. */
  visible = false;

  private target: HTMLElement | null = null;
  private timer: any = null;

  constructor(private zone: NgZone, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    // Outside Angular: pointer movement over the whole document must not run change
    // detection on every event. Showing the bubble re-enters explicitly.
    this.zone.runOutsideAngular(() => {
      document.addEventListener('mouseover', this.onPointerOver, true);
      document.addEventListener('mouseout', this.onPointerOut as EventListener, true);
      document.addEventListener('mousedown', this.hide, true);
      document.addEventListener('keydown', this.onKeydown, true);
      document.addEventListener('scroll', this.hide, true);
      window.addEventListener('blur', this.hide);
    });
  }

  ngOnDestroy(): void {
    document.removeEventListener('mouseover', this.onPointerOver, true);
    document.removeEventListener('mouseout', this.onPointerOut as EventListener, true);
    document.removeEventListener('mousedown', this.hide, true);
    document.removeEventListener('keydown', this.onKeydown, true);
    document.removeEventListener('scroll', this.hide, true);
    window.removeEventListener('blur', this.hide);
    clearTimeout(this.timer);
  }

  private onPointerOver = (event: Event): void => {
    const element = (event.target as HTMLElement)?.closest?.('[title], [data-tooltip]') as HTMLElement | null;
    if (!element || element === this.target) return;

    const label = this.labelFor(element);
    if (!label) return;

    this.hide();
    this.target = element;
    this.timer = setTimeout(() => this.show(element, label), OPEN_DELAY_MS);
  };

  /**
   * Hide only when the pointer actually leaves the element.
   *
   * Moving onto a child fires mouseout on the parent too, so the icon inside a button used
   * to cancel that button's tooltip before it could appear.
   */
  private onPointerOut = (event: MouseEvent): void => {
    if (!this.target) return;
    const movedTo = event.relatedTarget as Node | null;
    if (movedTo && this.target.contains(movedTo)) return;
    this.hide();
  };

  private onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.hide();
  };

  /**
   * The text to show, taken from the element's own title the first time it is hovered.
   *
   * Removing the attribute is what stops the browser drawing its own tooltip on top of
   * ours; the text is kept on the element so a later hover still has it, and copied to
   * aria-label when the element has no other accessible name.
   */
  private labelFor(element: HTMLElement): string {
    const title = element.getAttribute('title');
    if (title !== null) {
      const trimmed = title.trim();
      element.removeAttribute('title');
      if (!trimmed) return element.dataset['tooltip'] || '';
      element.dataset['tooltip'] = trimmed;
      if (!element.getAttribute('aria-label') && !element.textContent?.trim()) {
        element.setAttribute('aria-label', trimmed);
      }
    }
    return element.dataset['tooltip'] || '';
  }

  private show(element: HTMLElement, label: string): void {
    if (!element.isConnected) return;

    this.zone.run(() => {
      this.text = label;
      this.visible = false;
      this.cdr.detectChanges(); // render it so its size can be measured

      const bubble = (document.querySelector('.tooltip-bubble') as HTMLElement) || null;
      const rect = element.getBoundingClientRect();
      const width = bubble?.offsetWidth ?? 0;
      const height = bubble?.offsetHeight ?? 0;

      this.below = rect.top - OFFSET_PX - height < EDGE_PX;
      this.top = this.below ? rect.bottom + OFFSET_PX : rect.top - OFFSET_PX - height;
      this.left = Math.min(
        Math.max(EDGE_PX, rect.left + rect.width / 2 - width / 2),
        window.innerWidth - width - EDGE_PX
      );

      this.visible = true;
      this.cdr.detectChanges();
    });
  }

  private hide = (): void => {
    clearTimeout(this.timer);
    this.target = null;
    if (!this.text) return;
    this.zone.run(() => {
      this.text = '';
      this.visible = false;
      this.cdr.detectChanges();
    });
  };
}
