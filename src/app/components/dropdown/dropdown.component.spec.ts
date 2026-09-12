import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { DropdownComponent } from './dropdown.component';

@Component({
  standalone: true,
  imports: [DropdownComponent, FormsModule],
  template: `<app-dropdown [options]="options" [(ngModel)]="value" [disabled]="disabled" placeholder="Pick one"></app-dropdown>`
})
class HostComponent {
  options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' }
  ];
  value: string | null = 'b';
  disabled = false;
}

describe('DropdownComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let dropdown: DropdownComponent;

  const button = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  const items = () => Array.from(fixture.nativeElement.querySelectorAll('.dropdown-menu div[role="option"]')) as HTMLElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    dropdown = fixture.debugElement.children[0].componentInstance as DropdownComponent;
  });

  it('shows the label of the bound value', () => {
    expect(button().textContent).toContain('Beta');
    expect(dropdown.selectedOption?.value).toBe('b');
  });

  it('shows the placeholder when nothing matches', async () => {
    host.value = null;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(button().textContent).toContain('Pick one');
  });

  it('opens on click and writes the picked option back to the model', () => {
    button().click();
    fixture.detectChanges();
    expect(dropdown.open).toBeTrue();
    expect(items().length).toBe(3);
    expect(items()[1].classList).toContain('selected');

    items()[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();
    expect(host.value).toBe('c');
    expect(dropdown.open).toBeFalse();
    expect(button().textContent).toContain('Gamma');
  });

  it('supports keyboard navigation', () => {
    const key = (k: string) => button().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('ArrowDown');
    fixture.detectChanges();
    expect(dropdown.open).toBeTrue();
    expect(dropdown.highlightedIndex).toBe(1);
    key('ArrowDown');
    key('Enter');
    fixture.detectChanges();
    expect(host.value).toBe('c');
    expect(dropdown.open).toBeFalse();

    key('ArrowUp');
    key('Escape');
    fixture.detectChanges();
    expect(dropdown.open).toBeFalse();
  });

  it('closes when clicking outside', () => {
    button().click();
    fixture.detectChanges();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();
    expect(dropdown.open).toBeFalse();
  });

  it('does nothing while disabled', async () => {
    host.disabled = true;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(button().disabled).toBeTrue();
    dropdown.toggle();
    expect(dropdown.open).toBeFalse();
  });

  it('floats the list against the viewport, under the field', () => {
    button().click();
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('.dropdown-menu') as HTMLElement;
    const field = button().getBoundingClientRect();

    // Fixed rather than absolute, so a modal or drawer that hides its overflow cannot clip it.
    expect(getComputedStyle(menu).position).toBe('fixed');
    expect(menu.getBoundingClientRect().left).toBeCloseTo(field.left, 0);
    expect(menu.getBoundingClientRect().top).toBeGreaterThanOrEqual(field.bottom);
  });

  it('follows the field when the page scrolls', () => {
    button().click();
    fixture.detectChanges();
    const before = { ...(dropdown as any).menuPosition };

    (dropdown as any).menuPosition = { left: -999, top: -999 };
    dropdown.onViewportChange();

    expect((dropdown as any).menuPosition).toEqual(before);
  });

  it('emits valueChange only when the value actually changes', () => {
    const emitted: any[] = [];
    dropdown.valueChange.subscribe(v => emitted.push(v));
    dropdown.select({ value: 'b', label: 'Beta' });
    dropdown.select({ value: 'a', label: 'Alpha' });
    expect(emitted).toEqual(['a']);
  });
});
