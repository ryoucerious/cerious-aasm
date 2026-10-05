import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { NgIf, NgFor, NgClass, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ModalComponent } from '../../../components/modal/modal.component';
import { DropdownComponent, DropdownOption } from '../../../components/dropdown/dropdown.component';
import {
  Permission, PermissionInfo, Role, User, ADMIN_ROLE_ID, MIN_PASSWORD_LENGTH, OPERATOR_ROLE_ID, PERMISSIONS,
  accountPermissionFor, isPoolRole
} from '../../../core/models/auth.model';

interface PermissionGroup {
  name: string;
  permissions: PermissionInfo[];
}

/**
 * Accounts and roles, inside the settings drawer.
 *
 * Everything here is also enforced in the backend; the UI only hides what cannot be done so
 * the controls match the rules. The desktop app is always an administrator and never signs
 * in, so it manages the accounts that govern web access.
 */
@Component({
  selector: 'app-users-settings',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, DatePipe, FormsModule, ModalComponent, DropdownComponent],
  templateUrl: './users-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UsersSettingsComponent implements OnInit {
  readonly minPasswordLength = MIN_PASSWORD_LENGTH;
  view: 'users' | 'roles' = 'users';
  loading = true;

  users: User[] = [];
  roles: Role[] = [];
  permissionCatalog: PermissionInfo[] = [];
  /**
   * Derived once per load rather than per change detection pass. As getters these rebuilt
   * their *ngFor rows constantly, which stopped the checkboxes and dropdown from being
   * clickable (see the note in settings.component.ts).
   */
  permissionGroups: PermissionGroup[] = [];
  roleOptions: DropdownOption<string>[] = [];
  /** The admin pool first, then every active operator. */
  ownerOptions: DropdownOption<string>[] = [];
  /** False when the current account may create no kind of account at all. */
  canAddUser = false;

  showUserModal = false;
  editingUser: User | null = null;
  form = { username: '', displayName: '', password: '', roleId: '', active: true, ownerUserId: '' };
  saving = false;

  showRoleModal = false;
  editingRole: Role | null = null;
  roleForm: { name: string; description: string; permissions: Set<Permission> } =
    { name: '', description: '', permissions: new Set<Permission>() };

  userToDelete: User | null = null;
  roleToDelete: Role | null = null;

  constructor(
    private auth: AuthService,
    private notification: NotificationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.cdr.markForCheck();
    try {
      const [usersAndRoles, roleInfo] = await Promise.all([
        this.auth.listUsersAndRoles(),
        this.auth.listRoles()
      ]);
      this.users = usersAndRoles.users;
      this.roles = roleInfo.roles.length ? roleInfo.roles : usersAndRoles.roles;
      this.permissionCatalog = roleInfo.permissions;
      this.roleOptions = this.roleChoices(null);
      this.canAddUser = this.roleOptions.length > 0;
      this.ownerOptions = [
        { value: '', label: 'Admin pool' },
        ...this.users.filter(user => user.roleId === OPERATOR_ROLE_ID && user.active).map(user => ({ value: user.id, label: user.displayName || user.username }))
      ];
      this.permissionGroups = this.buildPermissionGroups();
    } catch (error) {
      console.error('[users-settings] Could not load the accounts:', error);
      this.notification.error('Could not load the accounts.', 'Accounts');
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  get currentUserId(): string | null {
    return this.auth.currentUser?.id ?? null;
  }

  get isAdmin(): boolean {
    return this.auth.identity.isAdmin;
  }

  /** Roles are edited by admins and users.manage holders; a pool owner only sees their accounts. */
  get canManageRoles(): boolean {
    return this.isAdmin || this.auth.can(PERMISSIONS.USERS_MANAGE);
  }

  /** Whether the pool field is offered: only those who may place accounts, and only for pool roles. */
  get showOwnerField(): boolean {
    return this.canManageRoles && isPoolRole(this.form.roleId);
  }

  canEditAccount(user: User): boolean {
    if (this.canManageRoles) return true;
    return this.holds(user.roleId, 'create');
  }

  canDeleteAccount(user: User): boolean {
    if (this.canManageRoles) return true;
    return this.holds(user.roleId, 'delete');
  }

  /** Where an account sits: "Admin", "Operators", "Admin pool", or the owning operator's name. */
  poolLabel(user: User): string {
    if (user.roleId === ADMIN_ROLE_ID) return 'Admin';
    if (user.roleId === OPERATOR_ROLE_ID) return 'Operators';
    if (!user.ownerUserId) return 'Admin pool';
    const owner = this.users.find(account => account.id === user.ownerUserId);
    return owner ? (owner.displayName || owner.username) : 'Operator';
  }

  private holds(roleId: string, action: 'create' | 'delete'): boolean {
    const permission = accountPermissionFor(roleId, action);
    return !!permission && this.auth.can(permission);
  }

  /**
   * The roles the current account may hand out, for the role dropdown. An admin may give any;
   * a users.manage holder any whose permissions they hold; a pool owner the pool roles they may
   * create. The account being edited keeps its own role in the list.
   */
  private roleChoices(editing: User | null): DropdownOption<string>[] {
    return this.roles
      .filter(role => role.id === editing?.roleId || this.canOfferRole(role))
      .map(role => ({ value: role.id, label: role.name }));
  }

  private canOfferRole(role: Role): boolean {
    if (this.isAdmin) return true;
    if (role.id === ADMIN_ROLE_ID) return false;
    if (this.auth.can(PERMISSIONS.USERS_MANAGE)) return role.permissions.every(permission => this.auth.can(permission));
    return isPoolRole(role.id) && this.holds(role.id, 'create');
  }

  private buildPermissionGroups(): PermissionGroup[] {
    const groups = new Map<string, PermissionInfo[]>();
    for (const permission of this.permissionCatalog) {
      const list = groups.get(permission.group) || [];
      list.push(permission);
      groups.set(permission.group, list);
    }
    return Array.from(groups.entries()).map(([name, permissions]) => ({ name, permissions }));
  }

  trackByGroupName(_index: number, group: PermissionGroup): string {
    return group.name;
  }

  trackByPermission(_index: number, permission: PermissionInfo): string {
    return permission.id;
  }

  roleName(roleId: string): string {
    return this.roles.find(role => role.id === roleId)?.name || 'Unknown';
  }

  isAdminRole(role: Role | null): boolean {
    return role?.id === ADMIN_ROLE_ID;
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  openCreateUser(): void {
    this.editingUser = null;
    this.roleOptions = this.roleChoices(null);
    const offered = this.roleOptions.map(option => option.value);
    this.form = {
      username: '',
      displayName: '',
      password: '',
      roleId: offered.find(id => id !== ADMIN_ROLE_ID) || offered[0] || '',
      active: true,
      ownerUserId: ''
    };
    this.showUserModal = true;
    this.cdr.markForCheck();
  }

  openEditUser(user: User): void {
    this.editingUser = user;
    this.roleOptions = this.roleChoices(user);
    this.form = {
      username: user.username,
      displayName: user.displayName,
      password: '',
      roleId: user.roleId,
      active: user.active,
      ownerUserId: user.ownerUserId || ''
    };
    this.showUserModal = true;
    this.cdr.markForCheck();
  }

  closeUserModal(): void {
    if (this.saving) return;
    this.showUserModal = false;
    this.cdr.markForCheck();
  }

  get canSaveUser(): boolean {
    if (this.saving || !this.form.username.trim() || !this.form.roleId) return false;
    // A new account needs a password; an existing one only when changing it.
    if (this.editingUser && !this.form.password) return true;
    return this.form.password.length >= MIN_PASSWORD_LENGTH;
  }

  async saveUser(): Promise<void> {
    if (!this.canSaveUser) return;
    this.saving = true;
    this.cdr.markForCheck();

    // A pool owner's accounts always land in their own pool; only those who may choose send one.
    const owner = this.canManageRoles
      ? { ownerUserId: isPoolRole(this.form.roleId) ? (this.form.ownerUserId || null) : null }
      : {};
    const result = this.editingUser
      ? await this.auth.updateUser({
          id: this.editingUser.id,
          username: this.form.username.trim(),
          displayName: this.form.displayName.trim(),
          roleId: this.form.roleId,
          active: this.form.active,
          ...owner,
          ...(this.form.password ? { password: this.form.password } : {})
        })
      : await this.auth.createUser({
          username: this.form.username.trim(),
          displayName: this.form.displayName.trim(),
          password: this.form.password,
          roleId: this.form.roleId,
          active: this.form.active,
          ...owner
        });

    this.saving = false;
    if (result.success) {
      this.notification.success(this.editingUser ? 'User updated' : 'User created', 'Accounts');
      this.showUserModal = false;
      await this.reload();
    } else {
      this.notification.error(result.error || 'Could not save the user', 'Accounts');
      this.cdr.markForCheck();
    }
  }

  requestDeleteUser(user: User): void {
    this.userToDelete = user;
    this.cdr.markForCheck();
  }

  async confirmDeleteUser(): Promise<void> {
    const user = this.userToDelete;
    if (!user) return;
    const result = await this.auth.deleteUser(user.id);
    this.userToDelete = null;
    if (result.success) {
      this.notification.success(`Deleted ${user.username}`, 'Accounts');
      await this.reload();
    } else {
      this.notification.error(result.error || 'Could not delete the user', 'Accounts');
      this.cdr.markForCheck();
    }
  }

  openCreateRole(): void {
    this.editingRole = null;
    this.roleForm = { name: '', description: '', permissions: new Set<Permission>() };
    this.showRoleModal = true;
    this.cdr.markForCheck();
  }

  openEditRole(role: Role): void {
    this.editingRole = role;
    this.roleForm = {
      name: role.name,
      description: role.description,
      permissions: new Set<Permission>(role.permissions)
    };
    this.showRoleModal = true;
    this.cdr.markForCheck();
  }

  closeRoleModal(): void {
    if (this.saving) return;
    this.showRoleModal = false;
    this.cdr.markForCheck();
  }

  togglePermission(permission: Permission, checked: boolean): void {
    checked ? this.roleForm.permissions.add(permission) : this.roleForm.permissions.delete(permission);
    this.cdr.markForCheck();
  }

  hasPermission(permission: Permission): boolean {
    return this.roleForm.permissions.has(permission);
  }

  /** Built-in roles have a fixed permission set, so the editor only shows it. */
  get roleEditorLocked(): boolean {
    return !!this.editingRole?.builtIn;
  }

  async saveRole(): Promise<void> {
    if (this.saving || !this.roleForm.name.trim() || this.roleEditorLocked) return;
    this.saving = true;
    this.cdr.markForCheck();

    const payload = {
      name: this.roleForm.name.trim(),
      description: this.roleForm.description.trim(),
      permissions: Array.from(this.roleForm.permissions)
    };
    const result = this.editingRole
      ? await this.auth.updateRole({ id: this.editingRole.id, ...payload })
      : await this.auth.createRole(payload);

    this.saving = false;
    if (result.success) {
      this.notification.success(this.editingRole ? 'Role updated' : 'Role created', 'Accounts');
      this.showRoleModal = false;
      await this.reload();
    } else {
      this.notification.error(result.error || 'Could not save the role', 'Accounts');
      this.cdr.markForCheck();
    }
  }

  requestDeleteRole(role: Role): void {
    this.roleToDelete = role;
    this.cdr.markForCheck();
  }

  async confirmDeleteRole(): Promise<void> {
    const role = this.roleToDelete;
    if (!role) return;
    const result = await this.auth.deleteRole(role.id);
    this.roleToDelete = null;
    if (result.success) {
      this.notification.success(`Deleted ${role.name}`, 'Accounts');
      await this.reload();
    } else {
      this.notification.error(result.error || 'Could not delete the role', 'Accounts');
      this.cdr.markForCheck();
    }
  }

  usersWithRole(roleId: string): number {
    return this.users.filter(user => user.roleId === roleId).length;
  }
}
