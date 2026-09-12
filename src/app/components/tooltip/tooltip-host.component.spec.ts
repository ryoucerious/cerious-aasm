import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TooltipHostComponent } from './tooltip-host.component';

describe('TooltipHostComponent', () => {
  let fixture: ComponentFixture<TooltipHostComponent>;
  let button: HTMLButtonElement;
  let icon: HTMLSpanElement;

  /** The bubble, or null when nothing is being described. */
  const bubble = (): HTMLElement | null => fixture.nativeElement.querySelector('.tooltip-bubble');

  /** Hover something the way the browser reports it: over the element, out of the last one. */
  function pointerTo(element: Element, from?: Element): void {
    if (from) from.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: element }));
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TooltipHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(TooltipHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();

    button = document.createElement('button');
    button.setAttribute('title', 'Stop all servers');
    icon = document.createElement('span');
    button.appendChild(icon);
    document.body.appendChild(button);
  });

  afterEach(() => {
    button.remove();
    fixture.nativeElement.remove();
  });

  it('shows the title in a bubble once the pointer rests on it', fakeAsync(() => {
    pointerTo(button);
    expect(bubble()).withContext('nothing appears immediately').toBeNull();

    tick(500);
    fixture.detectChanges();

    expect(bubble()?.textContent).toBe('Stop all servers');
  }));

  it('takes the title off the element so the browser draws nothing of its own', fakeAsync(() => {
    pointerTo(button);
    tick(500);

    expect(button.getAttribute('title')).toBeNull();
    // Kept for the next hover, and as the accessible name the title used to provide.
    expect(button.dataset['tooltip']).toBe('Stop all servers');
    expect(button.getAttribute('aria-label')).toBe('Stop all servers');
  }));

  it('stays up when the pointer moves onto a child of the same element', fakeAsync(() => {
    pointerTo(button);
    tick(500);
    fixture.detectChanges();

    // Moving onto the icon inside the button fires mouseout on the button itself.
    button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: icon }));
    icon.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();

    expect(bubble()?.textContent).toBe('Stop all servers');
  }));

  it('hides when the pointer leaves, and on Escape', fakeAsync(() => {
    pointerTo(button);
    tick(500);
    fixture.detectChanges();

    button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    fixture.detectChanges();
    expect(bubble()).toBeNull();

    pointerTo(button);
    tick(500);
    fixture.detectChanges();
    expect(bubble()).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(bubble()).toBeNull();
  }));

  it('ignores elements with nothing to say', fakeAsync(() => {
    const plain = document.createElement('div');
    document.body.appendChild(plain);

    pointerTo(plain);
    tick(500);
    fixture.detectChanges();

    expect(bubble()).toBeNull();
    plain.remove();
  }));
});
