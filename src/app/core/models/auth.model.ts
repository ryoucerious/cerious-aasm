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
  USERS_MANAGE: 'users.manage'
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const ADMIN_ROLE_ID = 'admin';

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
