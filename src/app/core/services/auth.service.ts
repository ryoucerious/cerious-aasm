import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom } from 'rxjs';
import { distinctUntilChanged, filter, map } from 'rxjs/operators';
import { MessagingService } from './messaging/messaging.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';
import { GlobalConfig } from '../interfaces/global-config.interface';
import {
  AuthenticatedUser, CurrentIdentity, Permission, PermissionInfo, PoolLabel, Role, User, ADMIN_ROLE_ID
} from '../models/auth.model';
import { ServerInstance } from '../models/server-instance.model';

export interface UsersAndRoles {
  users: User[];
  roles: Role[];
}

export interface SaveResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/** The outcome of a sign-in, for the login page to put into words. */
export interface LoginResult {
  success: boolean;
  /** The HTTP status; 0 when the server could not be reached. */
  status: number;
  error?: string;
}

interface CurrentUserReply extends Partial<CurrentIdentity> {
  success?: boolean;
}

/** How long a sign-in waits for the new socket before handing over to the app. */
const LOGIN_CONNECT_WAIT_MS = 4000;

const SIGNED_OUT: Omit<CurrentIdentity, 'accountsInUse'> = {
  user: null,
  isLocalDesktop: false,
  isAdmin: false,
  permissions: []
};

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
  /** Username of the login that predates accounts while authentication is on; null until known. */
  private readonly legacyUsername = new BehaviorSubject<string | null>(null);

  constructor(private messaging: MessagingService, private webSocket: WebSocketService, private ipc: IpcService) {
    // The web UI asks whenever its socket comes up: the session behind it may have changed
    // (signed in, expired, backend restarted). The desktop app has no socket and asks once.
    if (ipc.isElectron) this.refresh();
    webSocket.connected$.pipe(filter(connected => connected)).subscribe(() => this.refresh());
    // A change to accounts or roles can alter what this session may do.
    this.messaging.receiveMessage('users-changed').subscribe(() => this.refresh());
    this.messaging.receiveMessage<GlobalConfig>('global-config').subscribe(config => this.applyLegacyLogin(config));
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

  /**
   * The name to show for whoever is using the UI: the signed-in account, else the login that
   * predates accounts, else 'Admin'. The desktop app never signs in, so it is always 'Admin'.
   */
  get displayName$(): Observable<string> {
    return combineLatest([this.identitySubject, this.legacyUsername]).pipe(
      map(([identity, legacyUsername]) =>
        identity.user?.displayName || identity.user?.username || (this.ipc.isElectron ? '' : legacyUsername) || 'Admin'),
      distinctUntilChanged()
    );
  }

  /** Ask the backend who we are. Safe to call repeatedly. */
  refresh(): void {
    this.messaging.sendMessage<CurrentUserReply>('get-current-user', {}).subscribe({
      next: (res) => {
        if (!res || res.success === false) return;
        this.identitySubject.next({
          user: res.user || null,
          isLocalDesktop: !!res.isLocalDesktop,
          isAdmin: !!res.isAdmin,
          permissions: res.permissions || [],
          accountsInUse: !!res.accountsInUse
        });
        // A web session without an account signed in with the older single login, which only
        // the global config names. Its broadcasts keep the name current once known.
        if (!res.user && !this.ipc.isElectron && this.legacyUsername.value === null) this.loadLegacyLogin();
      },
      error: () => { /* keep the optimistic default; the backend still enforces */ }
    });
  }

  /**
   * Signs in to the web UI. On success the socket reconnects under the new session before this
   * resolves, so the pages behind the login do not ask for their data down a refused socket.
   */
  async login(username: string, password: string): Promise<LoginResult> {
    let response: Response;
    try {
      response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });
    } catch {
      return { success: false, status: 0 };
    }

    const body = await response.json().catch(() => null) as { success?: boolean; error?: string } | null;
    if (!response.ok || !body?.success) {
      return { success: false, status: response.status, ...(body?.error ? { error: body.error } : {}) };
    }

    // Opening the socket also refreshes the identity (see the constructor).
    this.webSocket.reconnectNow();
    await this.webSocket.whenConnected(LOGIN_CONNECT_WAIT_MS);
    return { success: true, status: response.status };
  }

  /** Ends the web session. Resolves false when the server did not confirm it; never rejects. */
  async logout(): Promise<boolean> {
    try {
      const response = await fetch('/api/logout', { method: 'POST', credentials: 'include' });
      if (!response.ok) {
        console.error('[auth] Sign-out failed with status', response.status);
        return false;
      }
    } catch (error) {
      console.error('[auth] Sign-out failed:', error);
      return false;
    }
    this.webSocket.endSession();
    this.identitySubject.next({ ...SIGNED_OUT, accountsInUse: this.identity.accountsInUse });
    return true;
  }

  /** True when the current session holds a permission. Admin and the desktop hold them all. */
  can(permission: Permission): boolean {
    const identity = this.identity;
    if (identity.isAdmin) return true;
    return identity.permissions.includes(permission);
  }

  async listUsersAndRoles(): Promise<UsersAndRoles> {
    const res = await this.send<Partial<UsersAndRoles>>('get-users', {});
    return { users: res?.users || [], roles: res?.roles || [] };
  }

  async listRoles(): Promise<{ roles: Role[]; permissions: PermissionInfo[] }> {
    const res = await this.send<{ roles?: Role[]; permissions?: PermissionInfo[] }>('get-roles', {});
    return { roles: res?.roles || [], permissions: res?.permissions || [] };
  }

  createUser(input: {
    username: string; password: string; displayName?: string; roleId: string; active?: boolean; ownerUserId?: string | null;
  }): Promise<SaveResult<User>> {
    return this.mutate<User>('create-user', input, 'user');
  }

  updateUser(input: {
    id: string; username?: string; displayName?: string; roleId?: string; active?: boolean; password?: string; ownerUserId?: string | null;
  }): Promise<SaveResult<User>> {
    return this.mutate<User>('update-user', input, 'user');
  }

  /** Names for the ownership line on a server; what comes back depends on who is asking. */
  async listPoolLabels(): Promise<{ operators: PoolLabel[]; assignees: PoolLabel[] }> {
    const res = await this.send<{ operators?: PoolLabel[]; assignees?: PoolLabel[] }>('list-pool-labels', {});
    return { operators: res?.operators || [], assignees: res?.assignees || [] };
  }

  /** Attaches a server manager or attendant to a server, or detaches with null. Admin or the pool's operator. */
  assignServerManager(instanceId: string, managerUserId: string | null): Promise<SaveResult<ServerInstance>> {
    return this.mutate<ServerInstance>('assign-server-manager', { instanceId, managerUserId }, 'instance');
  }

  /** Moves a server into an operator's pool, or back to the admin pool with null. Admin only. */
  setServerOperator(instanceId: string, operatorUserId: string | null): Promise<SaveResult<ServerInstance>> {
    return this.mutate<ServerInstance>('set-server-operator', { instanceId, operatorUserId }, 'instance');
  }

  deleteUser(id: string): Promise<SaveResult> {
    return this.mutate('delete-user', { id });
  }

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

  private loadLegacyLogin(): void {
    this.messaging.sendMessage<GlobalConfig>('get-global-config', {}).subscribe({
      next: config => this.applyLegacyLogin(config),
      error: () => { /* the name falls back to 'Admin' */ }
    });
  }

  private applyLegacyLogin(config: Partial<GlobalConfig> | null | undefined): void {
    this.legacyUsername.next(config?.authenticationEnabled ? config.authenticationUsername || '' : '');
  }

  private async send<T>(channel: string, payload: object): Promise<T | null> {
    try {
      return await firstValueFrom(this.messaging.sendMessage<T>(channel, payload));
    } catch {
      return null;
    }
  }

  private async mutate<T>(channel: string, payload: object, dataKey?: string): Promise<SaveResult<T>> {
    const res = await this.send<{ success?: boolean; error?: string } & Record<string, unknown>>(channel, payload);
    if (!res) return { success: false, error: 'No response from the server.' };
    if (res.success === false) return { success: false, error: res.error || 'That did not work.' };
    return { success: true, data: dataKey ? res[dataKey] as T : undefined };
  }
}
