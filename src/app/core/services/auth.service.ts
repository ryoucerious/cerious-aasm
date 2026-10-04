import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { MessagingService } from './messaging/messaging.service';
import {
  AuthenticatedUser, CurrentIdentity, Permission, PermissionInfo, Role, User, ADMIN_ROLE_ID
} from '../models/auth.model';

export interface UsersAndRoles {
  users: User[];
  roles: Role[];
}

export interface SaveResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Who is signed in, what they may do, and the user/role management calls.
 *
 * The backend enforces every permission on the message bus; this service exists so the UI
 * can hide controls a role cannot use, which is presentation rather than security. Anything
 * it allows through is still checked server-side.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly identitySubject = new BehaviorSubject<CurrentIdentity>({
    user: null,
    // Assume the desktop until told otherwise, so the app is usable during the first load
    // rather than briefly showing everything as forbidden.
    isLocalDesktop: true,
    isAdmin: true,
    permissions: [],
    accountsInUse: false
  });

  constructor(private messaging: MessagingService) {
    this.refresh();
    // A change to accounts or roles can alter what this session may do.
    this.messaging.receiveMessage('users-changed').subscribe(() => this.refresh());
  }

  get identity(): CurrentIdentity {
    return this.identitySubject.value;
  }

  get identity$(): Observable<CurrentIdentity> {
    return this.identitySubject.asObservable();
  }

  get currentUser(): AuthenticatedUser | null {
    return this.identity.user;
  }

  /** Ask the backend who we are. Safe to call repeatedly. */
  refresh(): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(), 4000);
      this.messaging.sendMessage<any>('get-current-user', {}).pipe(take(1)).subscribe({
        next: (res) => {
          clearTimeout(timer);
          if (res && res.success !== false) {
            this.identitySubject.next({
              user: res.user || null,
              isLocalDesktop: !!res.isLocalDesktop,
              isAdmin: !!res.isAdmin,
              permissions: res.permissions || [],
              accountsInUse: !!res.accountsInUse
            });
          }
          resolve();
        },
        error: () => {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  /** Drop the signed-in account so a later sign-in is not shown as the previous person. */
  forget(): void {
    this.identitySubject.next({
      user: null,
      isLocalDesktop: false,
      isAdmin: false,
      permissions: [],
      accountsInUse: this.identity.accountsInUse
    });
  }

  /** True when the current session holds a permission. Admin and the desktop hold them all. */
  can(permission: Permission): boolean {
    const identity = this.identity;
    if (identity.isAdmin) return true;
    return identity.permissions.includes(permission);
  }

  can$(permission: Permission): Observable<boolean> {
    return new Observable<boolean>(observer => {
      const sub = this.identity$.subscribe(() => observer.next(this.can(permission)));
      return () => sub.unsubscribe();
    });
  }

  // -------------------- Users --------------------

  async listUsersAndRoles(): Promise<UsersAndRoles> {
    const res = await this.send<any>('get-users', {});
    return { users: res?.users || [], roles: res?.roles || [] };
  }

  async listRoles(): Promise<{ roles: Role[]; permissions: PermissionInfo[] }> {
    const res = await this.send<any>('get-roles', {});
    return { roles: res?.roles || [], permissions: res?.permissions || [] };
  }

  createUser(input: { username: string; password: string; displayName?: string; roleId: string; active?: boolean; ownerUserId?: string | null }): Promise<SaveResult<User>> {
    return this.mutate<User>('create-user', input, 'user');
  }

  async listServerManagers(): Promise<{
    managers: Array<{ id: string; username: string; displayName: string; roleId?: string; roleName?: string; ownerUserId?: string | null }>;
    operators: Array<{ id: string; username: string; displayName: string; roleId?: string; roleName?: string }>;
  }> {
    const res = await this.send<any>('list-server-managers', {});
    return { managers: res?.managers || [], operators: res?.operators || [] };
  }

  async listOwnershipLabels(): Promise<{
    operators: Array<{ id: string; username: string; displayName: string }>;
    assignees: Array<{ id: string; username: string; displayName: string; roleName?: string }>;
  }> {
    const res = await this.send<any>('list-ownership-labels', {});
    return { operators: res?.operators || [], assignees: res?.assignees || [] };
  }

  createServerManager(input: { username: string; password: string; displayName?: string; roleId?: string; ownerUserId?: string | null }): Promise<SaveResult<User>> {
    return this.mutate<User>('create-server-manager', input, 'user');
  }

  assignServerManager(instanceId: string, managerUserId: string | null): Promise<SaveResult> {
    return this.mutate('assign-server-manager', { instanceId, managerUserId });
  }

  async setServerOperator(instanceId: string, operatorUserId: string | null): Promise<SaveResult<any>> {
    const res: any = await this.send<any>('set-server-operator', { instanceId, operatorUserId });
    if (!res) return { success: false, error: 'No response from the server.' };
    if (res.success === false) return { success: false, error: res.error || 'Could not move that server.' };
    return { success: true, data: res.instance };
  }

  updateUser(input: { id: string; username?: string; displayName?: string; roleId?: string; active?: boolean; password?: string; ownerUserId?: string | null }): Promise<SaveResult<User>> {
    return this.mutate<User>('update-user', input, 'user');
  }

  deleteUser(id: string): Promise<SaveResult> {
    return this.mutate('delete-user', { id });
  }

  // -------------------- Roles --------------------

  createRole(input: { name: string; description?: string; permissions: Permission[] }): Promise<SaveResult<Role>> {
    return this.mutate<Role>('create-role', input, 'role');
  }

  updateRole(input: { id: string; name?: string; description?: string; permissions: Permission[] }): Promise<SaveResult<Role>> {
    return this.mutate<Role>('update-role', input, 'role');
  }

  deleteRole(id: string): Promise<SaveResult> {
    return this.mutate('delete-role', { id });
  }

  changeOwnPassword(currentPassword: string, newPassword: string): Promise<SaveResult> {
    return this.mutate('change-own-password', { currentPassword, newPassword });
  }

  /** The Admin role is fixed: it always holds every permission and cannot be edited. */
  isAdminRole(role: Role | null | undefined): boolean {
    return role?.id === ADMIN_ROLE_ID;
  }

  // -------------------- Transport --------------------

  private async send<T>(channel: string, payload: any): Promise<T | null> {
    try {
      return await firstValueFrom(this.messaging.sendMessage<T>(channel, payload).pipe(take(1)));
    } catch {
      return null;
    }
  }

  private async mutate<T>(channel: string, payload: any, dataKey?: string): Promise<SaveResult<T>> {
    const res: any = await this.send<any>(channel, payload);
    if (!res) return { success: false, error: 'No response from the server.' };
    if (res.success === false) return { success: false, error: res.error || 'That did not work.' };
    return { success: true, data: dataKey ? res[dataKey] : undefined };
  }
}
