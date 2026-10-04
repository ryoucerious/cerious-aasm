import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalComponent } from './modal.component';

describe('ModalComponent', () => {
  let component: ModalComponent;
  let fixture: ComponentFixture<ModalComponent>;
  let closed: jasmine.Spy;

  const backdrop = () => fixture.nativeElement.querySelector('.modal-backdrop') as HTMLElement;
  const dialog = () => fixture.nativeElement.querySelector('.modal') as HTMLElement;

  function pressEscape(): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    return event;
  }

  function click(pressOn: HTMLElement, releaseOn: HTMLElement): void {
    pressOn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    releaseOn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ModalComponent] }).compileComponents();
    fixture = TestBed.createComponent(ModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('title', 'Confirm Delete');
    fixture.componentRef.setInput('show', true);
    fixture.detectChanges();
    closed = jasmine.createSpy('close');
    component.close.subscribe(closed);
  });

  it('is announced as a modal dialog named by its title', () => {
    expect(dialog().getAttribute('role')).toBe('dialog');
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog().getAttribute('aria-labelledby') || '');
    expect(title?.textContent).toContain('Confirm Delete');
  });

  it('closes on Escape and marks the key handled', () => {
    const event = pressEscape();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBeTrue();
  });

  it('leaves an Escape that something inside it already handled', () => {
    dialog().addEventListener('keydown', event => event.preventDefault(), { once: true });
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(closed).not.toHaveBeenCalled();
  });

  it('ignores Escape while hidden', () => {
    fixture.componentRef.setInput('show', false);
    fixture.detectChanges();
    pressEscape();
    expect(closed).not.toHaveBeenCalled();
  });

  it('closes on a click on the backdrop', () => {
    click(backdrop(), backdrop());
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('stays open for a click inside the dialog', () => {
    click(dialog(), dialog());
    expect(closed).not.toHaveBeenCalled();
  });

  it('stays open when a press inside the dialog is released over the backdrop', () => {
    click(dialog(), backdrop());
    expect(closed).not.toHaveBeenCalled();
  });
});
