import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { NgIf, NgFor, NgClass, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ModalComponent } from '../../../components/modal/modal.component';
import { DropdownComponent, DropdownOption } from '../../../components/dropdown/dropdown.component';
import { Permission, PermissionInfo, Role, User, ADMIN_ROLE_ID } from '../../../core/models/auth.model';

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
  view: 'users' | 'roles' = 'users';
  loading = true;

  users: User[] = [];
  roles: Role[] = [];
  permissionCatalog: PermissionInfo[] = [];
  /**
   * Derived once per load rather than per change detection pass. As getters these rebuilt
   * their *ngFor rows constantly, which stopped the checkboxes and dropdown from being
   * clickable — see the note in settings.component.ts.
   */
  permissionGroups: PermissionGroup[] = [];
  roleOptions: DropdownOption<string>[] = [];

  // User editor
  showUserModal = false;
  editingUser: User | null = null;
  form = { username: '', displayName: '', password: '', roleId: '', active: true };
  saving = false;

  // Role editor
  showRoleModal = false;
  editingRole: Role | null = null;
  roleForm: { name: string; description: string; permissions: Set<Permission> } =
    { name: '', description: '', permissions: new Set<Permission>() };

  // Deletion
  userToDelete: User | null = null;
  roleToDelete: Role | null = null;

  // Change own password

  constructor(
    private auth: AuthService,
    private notification: NotificationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.reload();
  }

  // -------------------- Loading --------------------

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
      this.roleOptions = this.roles.map(role => ({ value: role.id, label: role.name }));
      this.permissionGroups = this.buildPermissionGroups();
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  get isDesktop(): boolean {
    return this.auth.identity.isLocalDesktop;
  }

  get currentUserId(): string | null {
    return this.auth.currentUser?.id ?? null;
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

  isAdminRole(role: Role): boolean {
    return role.id === ADMIN_ROLE_ID;
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  // -------------------- Users --------------------

  openCreateUser(): void {
    this.editingUser = null;
    this.form = {
      username: '',
      displayName: '',
      password: '',
      roleId: this.roles.find(role => role.id !== ADMIN_ROLE_ID)?.id || this.roles[0]?.id || '',
      active: true
    };
    this.showUserModal = true;
    this.cdr.markForCheck();
  }

  openEditUser(user: User): void {
    this.editingUser = user;
    this.form = {
      username: user.username,
      displayName: user.displayName,
      password: '',
      roleId: user.roleId,
      active: user.active
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
    return this.editingUser ? true : this.form.password.length >= 8;
  }

  async saveUser(): Promise<void> {
    if (!this.canSaveUser) return;
    this.saving = true;
    this.cdr.markForCheck();

    const result = this.editingUser
      ? await this.auth.updateUser({
          id: this.editingUser.id,
          username: this.form.username.trim(),
          displayName: this.form.displayName.trim(),
          roleId: this.form.roleId,
          active: this.form.active,
          ...(this.form.password ? { password: this.form.password } : {})
        })
      : await this.auth.createUser({
          username: this.form.username.trim(),
          displayName: this.form.displayName.trim(),
          password: this.form.password,
          roleId: this.form.roleId,
          active: this.form.active
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

  // -------------------- Roles --------------------

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

  /** The Admin role is fixed, so its editor is read-only. */
  get roleEditorLocked(): boolean {
    return !!this.editingRole && this.isAdminRole(this.editingRole);
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
