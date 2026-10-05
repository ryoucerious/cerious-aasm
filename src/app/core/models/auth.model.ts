/**
 * Users, roles and permissions, as the UI sees them.
 *
 * Mirrors electron/types/auth.types.ts. The permission strings are the contract between the
 * two, so they must stay identical; the backend is the one that enforces them, and this copy
 * exists only so the UI can hide what a role cannot do.
 */

export const PERMISSIONS = {
  SERVERS_VIEW: 'servers.view',
  SERVERS_CONTROL: 'servers.control',
  SERVERS_CREATE: 'servers.create',
  SERVERS_DELETE: 'servers.delete',
  SERVERS_CONFIGURE: 'servers.configure',
  RCON_USE: 'rcon.use',
  PLAYERS_VIEW: 'players.view',
  PLAYERS_MANAGE: 'players.manage',
  BACKUPS_VIEW: 'backups.view',
  BACKUPS_CREATE: 'backups.create',
  BACKUPS_RESTORE: 'backups.restore',
  BACKUPS_DELETE: 'backups.delete',
  MODS_MANAGE: 'mods.manage',
  AUTOMATION_MANAGE: 'automation.manage',
  APP_INSTALL: 'app.install',
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',
  USERS_MANAGE: 'users.manage',
  ACCOUNTS_MANAGERS_CREATE: 'accounts.managers.create',
  ACCOUNTS_MANAGERS_DELETE: 'accounts.managers.delete',
  ACCOUNTS_ATTENDANTS_CREATE: 'accounts.attendants.create',
  ACCOUNTS_ATTENDANTS_DELETE: 'accounts.attendants.delete',
  ACCOUNTS_VIEWERS_CREATE: 'accounts.viewers.create',
  ACCOUNTS_VIEWERS_DELETE: 'accounts.viewers.delete',
  NODES_VIEW: 'nodes.view',
  NODES_ENROLL: 'nodes.enroll',
  NODES_MANAGE: 'nodes.manage',
  NODES_REMOVE: 'nodes.remove',
  SERVERS_MOVE: 'servers.move',
  CLUSTERS_VIEW: 'clusters.view',
  CLUSTERS_MANAGE: 'clusters.manage',
  CLUSTERS_STORAGE_MANAGE: 'clusters.storage.manage',
  MESH_VIEW: 'mesh.view',
  MESH_CONFIGURE: 'mesh.configure',
  MESH_SECURITY_MANAGE: 'mesh.security.manage'
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const ADMIN_ROLE_ID = 'admin';
export const OPERATOR_ROLE_ID = 'operator';
export const SERVER_MANAGER_ROLE_ID = 'server-manager';
export const ATTENDANT_ROLE_ID = 'attendant';
export const VIEWER_ROLE_ID = 'viewer';

/** Server managers, attendants and viewers live in a pool. Admins and operators do not. */
export function isPoolRole(roleId: string | null | undefined): boolean {
  return roleId === SERVER_MANAGER_ROLE_ID || roleId === ATTENDANT_ROLE_ID || roleId === VIEWER_ROLE_ID;
}

/** A server is assigned to one person, who is either a server manager or an attendant. */
export function isAssignableRole(roleId: string | null | undefined): boolean {
  return roleId === SERVER_MANAGER_ROLE_ID || roleId === ATTENDANT_ROLE_ID;
}

/**
 * The permission for creating (also editing) or deleting one kind of pool account.
 * Mirrors accountPermission in electron/services/auth/pool-access.ts.
 */
export function accountPermissionFor(roleId: string, action: 'create' | 'delete'): Permission | null {
  const map: Record<string, { create: Permission; delete: Permission }> = {
    [SERVER_MANAGER_ROLE_ID]: { create: PERMISSIONS.ACCOUNTS_MANAGERS_CREATE, delete: PERMISSIONS.ACCOUNTS_MANAGERS_DELETE },
    [ATTENDANT_ROLE_ID]: { create: PERMISSIONS.ACCOUNTS_ATTENDANTS_CREATE, delete: PERMISSIONS.ACCOUNTS_ATTENDANTS_DELETE },
    [VIEWER_ROLE_ID]: { create: PERMISSIONS.ACCOUNTS_VIEWERS_CREATE, delete: PERMISSIONS.ACCOUNTS_VIEWERS_DELETE }
  };
  return map[roleId]?.[action] ?? null;
}

/** A name shown for an operator or an assignee. */
export interface PoolLabel {
  id: string;
  username: string;
  displayName: string;
  roleName: string;
  /** For an assignee, the operator whose pool they are in; null is the admin pool. */
  ownerUserId?: string | null;
}

/** The backend refuses shorter account passwords. */
export const MIN_PASSWORD_LENGTH = 8;

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  roleId: string;
  active: boolean;
  /** The operator whose pool this account is in. Null or missing is the admin pool. */
  ownerUserId?: string | null;
  /** Password is supplied on the command line and cannot be changed in the app. */
  cliLocked?: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export interface AuthenticatedUser extends User {
  roleName: string;
  permissions: Permission[];
}

/** One permission with its human description, for the role editor. */
export interface PermissionInfo {
  id: Permission;
  label: string;
  group: string;
  description: string;
}

/** Who the UI is acting as right now. */
export interface CurrentIdentity {
  user: AuthenticatedUser | null;
  /** True in the desktop app, which owns the machine and does not sign in. */
  isLocalDesktop: boolean;
  isAdmin: boolean;
  permissions: Permission[];
  /** True once at least one account exists. */
  accountsInUse: boolean;
}
