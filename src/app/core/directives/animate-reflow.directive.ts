import { Directive, ElementRef, NgZone, OnDestroy, OnInit, Input } from '@angular/core';

/** How long a card takes to slide to its new place. */
const DURATION_MS = 260;
/** Ease-out: quick to leave, gentle to settle. */
const EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
/** Below this the move is not worth animating, and rounding noise would animate constantly. */
const MIN_DELTA_PX = 1;

/**
 * Slides the children of a grid to their new places when the layout reflows.
 *
 * A CSS grid snaps: when the container narrows past a breakpoint the columns are recomputed
 * and every item jumps at once, with nothing to transition — the item's own properties never
 * changed, only the track it sits in. So this measures where the children were, and after the
 * reflow puts them back with a transform and lets that transform animate away (FLIP).
 *
 * Only a change in the number of columns animates. Resizing within one column count moves the
 * items continuously as the window is dragged, and animating that would leave them lagging
 * behind the cursor.
 */
@Directive({
  selector: '[appAnimateReflow]',
  standalone: true
})
export class AnimateReflowDirective implements OnInit, OnDestroy {
  /** Set to false to leave the layout alone (e.g. while something else owns the transforms). */
  @Input() animateReflowEnabled = true;

  private observer?: ResizeObserver;
  /** Where each child sat at the last settled layout, keyed by element. */
  private positions = new Map<HTMLElement, { left: number; top: number }>();
  private columns = 0;

  constructor(private host: ElementRef<HTMLElement>, private zone: NgZone) {}

  ngOnInit(): void {
    this.columns = this.columnCount();
    this.positions = this.measure();

    if (typeof ResizeObserver === 'undefined') return;

    // Outside Angular: a resize changes nothing the template renders, and running change
    // detection on every observer callback is exactly the kind of churn that made the app
    // feel slow.
    this.zone.runOutsideAngular(() => {
      this.observer = new ResizeObserver(() => this.onResize());
      this.observer.observe(this.host.nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  /**
   * Compare the layout against the last one and animate if the columns changed.
   * Public so a test can drive it without waiting on a real resize.
   */
  onResize(): void {
    const next = this.measure();
    const columns = this.columnCount();

    if (columns !== this.columns && this.canAnimate()) {
      this.slideFrom(this.positions, next);
    }

    this.columns = columns;
    this.positions = next;
  }

  private canAnimate(): boolean {
    if (!this.animateReflowEnabled) return false;
    // Dragging a card to reorder already owns the transform of every item in the list.
    if (this.host.nativeElement.classList.contains('cdk-drop-list-dragging')) return false;
    return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Layout positions of the children.
   *
   * offsetLeft/offsetTop rather than getBoundingClientRect: they ignore transforms, so a
   * measurement taken while a previous slide is still running still reports where the child
   * has actually landed.
   */
  private measure(): Map<HTMLElement, { left: number; top: number }> {
    const positions = new Map<HTMLElement, { left: number; top: number }>();
    for (const child of this.children()) {
      positions.set(child, { left: child.offsetLeft, top: child.offsetTop });
    }
    return positions;
  }

  /**
   * How many columns the grid is currently laying out.
   *
   * The computed value of grid-template-columns is resolved to pixel tracks, so counting them
   * is what tells a reflow (four columns became three) apart from the continuous width change
   * of dragging a window edge.
   */
  private columnCount(): number {
    const tracks = getComputedStyle(this.host.nativeElement).gridTemplateColumns;
    if (!tracks || tracks === 'none') return 0;
    return tracks.split(' ').filter(track => track.trim().length).length;
  }

  private children(): HTMLElement[] {
    return Array.from(this.host.nativeElement.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement
    );
  }

  /** Put each child back where it was, then let it transition to where it now belongs. */
  private slideFrom(
    before: Map<HTMLElement, { left: number; top: number }>,
    after: Map<HTMLElement, { left: number; top: number }>
  ): void {
    const moved: HTMLElement[] = [];

    for (const [child, to] of after) {
      const from = before.get(child);
      if (!from) continue; // new since the last layout: let it appear in place

      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < MIN_DELTA_PX && Math.abs(dy) < MIN_DELTA_PX) continue;

      child.style.transition = 'none';
      child.style.transform = `translate(${dx}px, ${dy}px)`;
      moved.push(child);
    }

    if (!moved.length) return;

    // Next frame, so the browser paints the old position before the transition starts.
    requestAnimationFrame(() => {
      for (const child of moved) {
        child.style.transition = `transform ${DURATION_MS}ms ${EASING}`;
        child.style.transform = '';
        this.clearWhenDone(child);
      }
    });
  }

  /** Leave no inline styles behind, so nothing here interferes with a later drag. */
  private clearWhenDone(child: HTMLElement): void {
    const done = () => {
      child.style.transition = '';
      child.style.transform = '';
      child.removeEventListener('transitionend', done);
    };
    child.addEventListener('transitionend', done);
    // A transition on an off-screen element may never fire transitionend.
    setTimeout(done, DURATION_MS + 50);
  }
}
