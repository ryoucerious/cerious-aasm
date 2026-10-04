import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldDefinition, FieldOption } from '../../../../core/services/field-definitions.service';
import { FieldMessages, FieldMessagesComponent } from '../../../field-messages/field-messages.component';

@Component({
  selector: 'app-general-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, FieldMessagesComponent],
  templateUrl: './general-tab.component.html'
})
export class GeneralTabComponent implements OnChanges {
  // Fields are addressed by key from the settings metadata, so this stays loosely typed.
  @Input() serverInstance: any = {};
  @Input() isLocked = false;
  @Input() generalFields: FieldDefinition[] = [];
  @Input() dropdownOpen = false;
  @Input() fieldErrors: FieldMessages = {};
  @Input() fieldWarnings: FieldMessages = {};

  @Output() saveSettings = new EventEmitter<void>();
  @Output() validateField = new EventEmitter<{key: string, value: unknown}>();
  @Output() toggleMultiOption = new EventEmitter<{key: string, option: string, checked: boolean}>();
  /** A combo field was picked from its list or left after typing; the host validates it before saving. */
  @Output() comboCommit = new EventEmitter<{key: string, value: unknown}>();
  @Output() dropdownToggle = new EventEmitter<boolean>();

  /** The last value committed per combo field: picking from the list also blurs the input, which must not commit again. */
  private readonly committed = new Map<string, unknown>();

  ngOnChanges(changes: SimpleChanges): void {
    const server = changes['serverInstance'];
    // What was committed belongs to the previous server; keyed on the id because the same server
    // arrives as a new object after every save.
    if (server && server.previousValue?.id !== server.currentValue?.id) this.committed.clear();
  }

  /**
   * What a combo input shows: the option's display name for a known value, otherwise the value
   * itself. Typing maps back the same way, so an unchanged field round-trips to the same value.
   */
  comboText(field: FieldDefinition): string {
    const value = this.serverInstance?.[field.key];
    const option = this.comboOptions(field).find(opt => opt.value === value);
    return option?.display ?? (value == null ? '' : String(value));
  }

  comboOptions(field: FieldDefinition): Exclude<FieldOption, string>[] {
    return (field.options ?? []).filter((opt): opt is Exclude<FieldOption, string> => typeof opt !== 'string');
  }

  textOptions(field: FieldDefinition): string[] {
    return (field.options ?? []).filter((opt): opt is string => typeof opt === 'string');
  }

  onComboInput(field: FieldDefinition, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    const option = this.comboOptions(field).find(opt => opt.display === text);
    this.serverInstance[field.key] = option ? option.value : text;
  }

  onComboSelect(field: FieldDefinition, value: string): void {
    this.serverInstance[field.key] = value;
    this.commitCombo(field.key, value);
  }

  onComboBlur(field: FieldDefinition): void {
    const value = this.serverInstance[field.key];
    if (this.committed.has(field.key) && this.committed.get(field.key) === value) return;
    this.commitCombo(field.key, value);
  }

  onSaveSettings(): void {
    this.saveSettings.emit();
  }

  onValidateField(key: string, value: unknown): void {
    this.validateField.emit({key, value});
  }

  onToggleMultiOption(key: string, option: string, checked: boolean): void {
    this.toggleMultiOption.emit({key, option, checked});
  }

  onDropdownToggle(): void {
    this.dropdownToggle.emit(!this.dropdownOpen);
  }

  private commitCombo(key: string, value: unknown): void {
    this.committed.set(key, value);
    this.comboCommit.emit({ key, value });
  }
}
