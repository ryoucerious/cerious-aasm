import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BusyOverlayComponent } from './busy-overlay.component';
import { BusyService } from '../../core/services/busy.service';

describe('BusyOverlayComponent', () => {
  let fixture: ComponentFixture<BusyOverlayComponent>;
  let busy: BusyService;

  const overlay = (): HTMLElement | null => fixture.nativeElement.querySelector('.busy-overlay');

  /** Escape as the settings drawer and the modals hear it: on document, after it bubbles. */
  function escapeHandledElsewhere(): boolean {
    let handled = false;
    const listener = (event: Event) => { handled = event.defaultPrevented; };
    document.addEventListener('keydown', listener);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    document.removeEventListener('keydown', listener);
    return handled;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BusyOverlayComponent] }).compileComponents();
    busy = TestBed.inject(BusyService);
    fixture = TestBed.createComponent(BusyOverlayComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('shows nothing while nothing is under way', () => {
    expect(overlay()).toBeNull();
  });

  it('covers the app with a spinner and what is under way, until it is done', () => {
    const done = busy.start('Removing Docker 1…');
    fixture.detectChanges();

    expect(overlay()?.getAttribute('role')).toBe('status');
    expect(overlay()?.querySelector('.spinner')).toBeTruthy();
    expect(overlay()?.textContent).toContain('Removing Docker 1…');

    done();
    fixture.detectChanges();
    expect(overlay()).toBeNull();
  });

  // Escape closes the settings drawer and modals; closing one mid-change would leave the page
  // that started it, so the overlay takes Escape first while something is under way.
  it('keeps Escape from closing anything until it is done', () => {
    expect(escapeHandledElsewhere()).toBeFalse();

    const done = busy.start('Leaving the mesh…');
    expect(escapeHandledElsewhere()).toBeTrue();

    done();
    expect(escapeHandledElsewhere()).toBeFalse();
  });

  it('stops listening for Escape when it goes', () => {
    busy.start('Leaving the mesh…');

    fixture.destroy();

    expect(escapeHandledElsewhere()).toBeFalse();
  });
});
