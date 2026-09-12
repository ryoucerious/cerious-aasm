import {
  Component, Input, Output, EventEmitter, forwardRef, HostListener, ElementRef,
  ChangeDetectorRef, ChangeDetectionStrategy, ViewChild
} from '@angular/core';
import { NgIf, NgFor, NgClass } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { fixedOrigin } from '../../core/utils/floating';

export interface DropdownOption<T = any> {
  value: T;
  label: string;
}

/**
 * The app's dropdown, in the same style as the Map Selector on the General page: a
 * form-control button with a caret and a floating list of options. Works with ngModel /
 * reactive forms through ControlValueAccessor, so it drops in wherever a native <select>
 * would go. Options are matched by value, so any comparable value type is fine.
 */
@Component({
  selector: 'app-dropdown',
  standalone: true,
  imports: [NgIf, NgFor, NgClass],
  templateUrl: './dropdown.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DropdownComponent), multi: true }]
})
export class DropdownComponent<T = any> implements ControlValueAccessor {
  @Input() options: DropdownOption<T>[] = [];
  @Input() placeholder = 'Select...';
  @Input() disabled = false;
  @Input() ariaLabel = '';
  /** Optional id for the underlying button, for <label for>. */
  @Input() inputId = '';
  @Output() valueChange = new EventEmitter<T>();

  value: T | null = null;
  open = false;
  highlightedIndex = -1;
  /** Where the floating list sits, in viewport coordinates. */
  menuPosition = { left: 0, top: 0, width: 0 };

  @ViewChild('trigger') private trigger?: ElementRef<HTMLElement>;
  @ViewChild('menu') private menu?: ElementRef<HTMLElement>;

  private onChange: (value: T | null) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(private host: ElementRef<HTMLElement>, private cdr: ChangeDetectorRef) {}

  get selectedOption(): DropdownOption<T> | undefined {
    return this.options.find(option => option.value === this.value);
  }

  get displayLabel(): string {
    return this.selectedOption?.label ?? this.placeholder;
  }

  // -------------------- ControlValueAccessor --------------------

  writeValue(value: T | null): void {
    this.value = value;
    this.cdr.markForCheck();
  }

  registerOnChange(fn: (value: T | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    if (isDisabled) this.open = false;
    this.cdr.markForCheck();
  }

  // -------------------- Interaction --------------------

  toggle(): void {
    if (this.disabled) return;
    this.open ? this.close() : this.openMenu();
  }

  openMenu(): void {
    if (this.disabled) return;
    this.open = true;
    const current = this.options.findIndex(option => option.value === this.value);
    this.highlightedIndex = current >= 0 ? current : 0;
    this.positionMenu();
    this.cdr.markForCheck();
    // Again once the list exists, now that its height is known and it can be flipped above
    // the field if there is no room below.
    requestAnimationFrame(() => {
      this.positionMenu();
      this.cdr.detectChanges();
    });
  }

  /**
   * Place the list under (or over) the field in viewport coordinates.
   *
   * The list is fixed rather than absolute: an absolute list is clipped by any ancestor that
   * hides its overflow — a modal or a drawer — which cut the options off mid-list.
   */
  private positionMenu(): void {
    const field = this.trigger?.nativeElement;
    if (!field) return;

    const rect = field.getBoundingClientRect();
    const height = this.menu?.nativeElement.offsetHeight ?? 0;
    const gap = 4;
    const below = window.innerHeight - rect.bottom - gap;

    // Flip above only when the list does not fit below but does fit above.
    const flip = height > below && rect.top - gap > below;

    // Measured from whatever a fixed child is actually positioned against: the viewport
    // normally, but the settings drawer when the field is inside it, since the drawer
    // slides in on a transform.
    const origin = fixedOrigin(field);

    this.menuPosition = {
      left: rect.left - origin.x,
      top: (flip ? Math.max(gap, rect.top - gap - height) : rect.bottom + gap) - origin.y,
      width: rect.width
    };
  }

  /** A scroll or a resize moves the field, so the list has to follow it. */
  @HostListener('window:resize')
  @HostListener('document:scroll')
  onViewportChange(): void {
    if (!this.open) return;
    this.positionMenu();
    this.cdr.markForCheck();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.onTouched();
    this.cdr.markForCheck();
  }

  select(option: DropdownOption<T>): void {
    if (this.disabled) return;
    const changed = option.value !== this.value;
    this.value = option.value;
    this.open = false;
    if (changed) {
      this.onChange(option.value);
      this.valueChange.emit(option.value);
    }
    this.onTouched();
    this.cdr.markForCheck();
  }

  onKeydown(event: KeyboardEvent): void {
    if (this.disabled) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open) this.openMenu();
        else this.highlightedIndex = Math.min(this.options.length - 1, this.highlightedIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!this.open) this.openMenu();
        else this.highlightedIndex = Math.max(0, this.highlightedIndex - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!this.open) this.openMenu();
        else if (this.options[this.highlightedIndex]) this.select(this.options[this.highlightedIndex]);
        break;
      case 'Escape':
        if (this.open) {
          event.preventDefault();
          this.close();
        }
        break;
      case 'Tab':
        this.close();
        break;
    }
    this.cdr.markForCheck();
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMousedown(event: Event): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  isSelected(option: DropdownOption<T>): boolean {
    return option.value === this.value;
  }

  trackByValue(_index: number, option: DropdownOption<T>): T {
    return option.value;
  }
}
