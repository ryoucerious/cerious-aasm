import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnimateReflowDirective } from './animate-reflow.directive';

@Component({
  standalone: true,
  imports: [AnimateReflowDirective],
  template: `
    <div class="grid" appAnimateReflow [style.width.px]="width">
      <div class="card"></div>
      <div class="card"></div>
      <div class="card"></div>
      <div class="card"></div>
    </div>
  `,
  styles: [`
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      gap: 0;
    }
    .card { height: 50px; }
  `]
})
class HostComponent {
  @ViewChild(AnimateReflowDirective) directive!: AnimateReflowDirective;
  width = 400;
}

describe('AnimateReflowDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  /** The cards, in document order. */
  const cards = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.card')) as HTMLElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    // The grid has to be in the document to lay out at all.
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
  });

  /** Narrow the grid enough that four columns become two, and let the directive react. */
  function reflowTo(width: number): void {
    host.width = width;
    fixture.detectChanges();
    host.directive.onResize();
  }

  it('slides the cards back to where they were when the column count changes', () => {
    const before = cards().map(card => card.offsetLeft);

    reflowTo(200);

    const after = cards().map(card => card.offsetLeft);
    expect(after).not.toEqual(before); // the reflow really happened

    // Each moved card is held at its old position by a transform, which is what then
    // animates away.
    const moved = cards().filter((card, index) => Math.abs(before[index] - after[index]) >= 1);
    expect(moved.length).toBeGreaterThan(0);
    moved.forEach(card => expect(card.style.transform).toMatch(/^translate\(/));
  });

  it('leaves the cards alone when the width changes without a reflow', () => {
    // Still four columns at 440px: wide enough for four 100px tracks, too narrow for five.
    reflowTo(440);
    cards().forEach(card => expect(card.style.transform).toBe(''));
  });

  it('does not fight a drag in progress', () => {
    const grid = fixture.nativeElement.querySelector('.grid') as HTMLElement;
    grid.classList.add('cdk-drop-list-dragging');

    reflowTo(200);

    cards().forEach(card => expect(card.style.transform).toBe(''));
  });

  it('respects a reduced-motion preference', () => {
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);

    reflowTo(200);

    cards().forEach(card => expect(card.style.transform).toBe(''));
  });
});
