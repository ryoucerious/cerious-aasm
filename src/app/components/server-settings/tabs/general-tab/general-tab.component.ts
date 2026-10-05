import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy, OnInit, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { FieldDefinition, FieldOption } from '../../../../core/services/field-definitions.service';
import { FieldMessages, FieldMessagesComponent } from '../../../field-messages/field-messages.component';
import { DropdownComponent, DropdownOption } from '../../../dropdown/dropdown.component';
import { AuthService } from '../../../../core/services/auth.service';
import { PoolDirectoryService } from '../../../../core/services/pool-directory.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { OPERATOR_ROLE_ID, PoolLabel } from '../../../../core/models/auth.model';

@Component({
  selector: 'app-general-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, FieldMessagesComponent, DropdownComponent],
  templateUrl: './general-tab.component.html'
})
export class GeneralTabComponent implements OnInit, OnChanges, OnDestroy {
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

  /** The admin pool first, then every operator this account may see. */
  operatorOptions: DropdownOption<string>[] = [];
  /** "Not assigned" first, then the assignees in this server's pool. */
  assigneeOptions: DropdownOption<string>[] = [];
  /** True while a pool or assignee change is on its way to the backend. */
  ownershipBusy = false;
  private directorySub?: Subscription;

  constructor(
    private auth: AuthService,
    private directory: PoolDirectoryService,
    private notification: NotificationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.directorySub = this.directory.changed$.subscribe(() => {
      this.refreshOwnershipOptions();
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.directorySub?.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const server = changes['serverInstance'];
    // What was committed belongs to the previous server; keyed on the id because the same server
    // arrives as a new object after every save.
    if (server && server.previousValue?.id !== server.currentValue?.id) this.committed.clear();
    if (server) this.refreshOwnershipOptions();
  }

  /** Ownership only means something once accounts exist. */
  get showOwnership(): boolean {
    return this.auth.identity.accountsInUse;
  }

  /** Moving a server between pools is the admin's call. */
  get canChooseOperator(): boolean {
    return this.auth.identity.isAdmin;
  }

  /** An admin, or the operator whose pool the server is in, picks who runs it. */
  get canChooseAssignee(): boolean {
    const identity = this.auth.identity;
    if (identity.isAdmin) return true;
    return identity.user?.roleId === OPERATOR_ROLE_ID && (this.serverInstance?.operatorUserId || null) === identity.user.id;
  }

  get operatorLabel(): string {
    return this.directory.operatorLabel(this.serverInstance);
  }

  get assigneeLabel(): string {
    return this.directory.assigneeLabel(this.serverInstance);
  }

  async onOperatorChange(value: string): Promise<void> {
    const next = value || null;
    if (!this.serverInstance?.id || next === (this.serverInstance.operatorUserId || null)) return;
    await this.changeOwnership(() => this.auth.setServerOperator(this.serverInstance.id, next), next ? 'Server moved to the pool.' : 'Server moved to the admin pool.');
  }

  async onAssigneeChange(value: string): Promise<void> {
    const next = value || null;
    if (!this.serverInstance?.id || next === (this.serverInstance.managerUserId || null)) return;
    await this.changeOwnership(() => this.auth.assignServerManager(this.serverInstance.id, next), next ? 'Server assigned.' : 'Server unassigned.');
  }

  private async changeOwnership(change: () => Promise<{ success: boolean; error?: string; data?: unknown }>, done: string): Promise<void> {
    this.ownershipBusy = true;
    try {
      const result = await change();
      if (result.success) {
        // The saved instance comes back on the bus too; applying it here keeps the dropdown in step.
        if (result.data && typeof result.data === 'object') Object.assign(this.serverInstance, result.data);
        this.notification.success(done, 'Ownership');
      } else {
        this.notification.error(result.error || 'That did not work.', 'Ownership');
      }
    } finally {
      this.ownershipBusy = false;
      this.refreshOwnershipOptions();
      this.cdr.markForCheck();
    }
  }

  private refreshOwnershipOptions(): void {
    const pool = this.serverInstance?.operatorUserId || null;
    this.operatorOptions = [
      { value: '', label: 'Admin pool' },
      ...this.directory.operators.map(person => ({ value: person.id, label: labelFor(person) }))
    ];
    this.assigneeOptions = [
      { value: '', label: 'Not assigned' },
      ...this.directory.assignees
        .filter(person => (person.ownerUserId || null) === pool)
        .map(person => ({ value: person.id, label: `${person.roleName ? person.roleName + ' · ' : ''}${labelFor(person)}` }))
    ];
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

function labelFor(person: PoolLabel): string {
  if (person.displayName && person.displayName !== person.username) return `${person.displayName} (${person.username})`;
  return person.username;
}
