/**
 * Users, roles and permissions.
 *
 * Shared by the main process (which owns the database and enforces permissions on the
 * message bus) and the web-server child process (which authenticates logins). The renderer
 * has its own mirror of the same vocabulary in src/app/core/models/auth.model.ts — keep the
 * two in step.
 */

/**
 * Every permission the app checks. Grouped by area; the string values are what get stored
 * in the roles table and compared at runtime, so they must not change casually.
 */
export const PERMISSIONS = {
  // Servers
  SERVERS_VIEW: 'servers.view',
  SERVERS_CONTROL: 'servers.control',
  SERVERS_CREATE: 'servers.create',
  SERVERS_DELETE: 'servers.delete',
  SERVERS_CONFIGURE: 'servers.configure',
  // Live operations
  RCON_USE: 'rcon.use',
  PLAYERS_VIEW: 'players.view',
  PLAYERS_MANAGE: 'players.manage',
  // Backups
  BACKUPS_VIEW: 'backups.view',
  BACKUPS_CREATE: 'backups.create',
  BACKUPS_RESTORE: 'backups.restore',
  BACKUPS_DELETE: 'backups.delete',
  // Content and scheduling
  MODS_MANAGE: 'mods.manage',
  AUTOMATION_MANAGE: 'automation.manage',
  // Application
  APP_INSTALL: 'app.install',
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',
  USERS_MANAGE: 'users.manage'
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** Human descriptions, for the role editor in the UI. */
export const PERMISSION_DESCRIPTIONS: Record<Permission, { label: string; group: string; description: string }> = {
  [PERMISSIONS.SERVERS_VIEW]:      { label: 'View servers',        group: 'Servers',     description: 'See the server list, status, logs and console output.' },
  [PERMISSIONS.SERVERS_CONTROL]:   { label: 'Start and stop',      group: 'Servers',     description: 'Start, stop and force-stop servers.' },
  [PERMISSIONS.SERVERS_CREATE]:    { label: 'Create servers',      group: 'Servers',     description: 'Add, clone and import server instances.' },
  [PERMISSIONS.SERVERS_DELETE]:    { label: 'Delete servers',      group: 'Servers',     description: 'Permanently remove a server instance.' },
  [PERMISSIONS.SERVERS_CONFIGURE]: { label: 'Edit configuration',  group: 'Servers',     description: 'Change server settings, rates, INI files and cluster options.' },
  [PERMISSIONS.RCON_USE]:          { label: 'Use RCON',            group: 'Operations',  description: 'Send RCON commands and broadcasts to a running server.' },
  [PERMISSIONS.PLAYERS_VIEW]:      { label: 'View players',        group: 'Operations',  description: 'See who is connected.' },
  [PERMISSIONS.PLAYERS_MANAGE]:    { label: 'Manage players',      group: 'Operations',  description: 'Edit the whitelist and exclusive join list.' },
  [PERMISSIONS.BACKUPS_VIEW]:      { label: 'View backups',        group: 'Backups',     description: 'List backups and download them.' },
  [PERMISSIONS.BACKUPS_CREATE]:    { label: 'Create backups',      group: 'Backups',     description: 'Take a manual backup and change the schedule.' },
  [PERMISSIONS.BACKUPS_RESTORE]:   { label: 'Restore backups',     group: 'Backups',     description: 'Overwrite a server from a backup.' },
  [PERMISSIONS.BACKUPS_DELETE]:    { label: 'Delete backups',      group: 'Backups',     description: 'Permanently remove a backup.' },
  [PERMISSIONS.MODS_MANAGE]:       { label: 'Manage mods',         group: 'Content',     description: 'Add, remove and configure mods and ArkApi plugins.' },
  [PERMISSIONS.AUTOMATION_MANAGE]: { label: 'Manage automation',   group: 'Content',     description: 'Auto-start, crash detection, scheduled restarts, Discord and broadcasts.' },
  [PERMISSIONS.APP_INSTALL]:       { label: 'Install and update',  group: 'Application', description: 'Install or update the ARK server and system dependencies.' },
  [PERMISSIONS.SETTINGS_VIEW]:     { label: 'View settings',       group: 'Application', description: 'Read application settings.' },
  [PERMISSIONS.SETTINGS_MANAGE]:   { label: 'Change settings',     group: 'Application', description: 'Change application settings, including the web server.' },
  [PERMISSIONS.USERS_MANAGE]:      { label: 'Manage users',        group: 'Application', description: 'Create users, reset passwords and assign roles.' }
};

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  /** Built-in roles cannot be deleted, and Admin's permissions cannot be edited. */
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

/** A user plus the resolved permissions of their role. Never carries the password hash. */
export interface AuthenticatedUser extends User {
  roleName: string;
  permissions: Permission[];
}

export const ROLE_IDS = {
  ADMIN: 'admin',
  SERVER_MANAGER: 'server-manager',
  OPERATOR: 'operator',
  VIEWER: 'viewer'
} as const;

/**
 * The roles created on first run. Admin always holds every permission, including any added
 * by a later version, so it is resolved dynamically rather than stored as a fixed list.
 */
export const BUILT_IN_ROLES: { id: string; name: string; description: string; permissions: Permission[] }[] = [
  {
    id: ROLE_IDS.ADMIN,
    name: 'Admin',
    description: 'Full access, including user management and application settings.',
    permissions: ALL_PERMISSIONS
  },
  {
    id: ROLE_IDS.SERVER_MANAGER,
    name: 'Server Manager',
    description: 'Runs and configures servers, mods, automation and backups. Cannot manage users or application settings.',
    permissions: [
      PERMISSIONS.SERVERS_VIEW, PERMISSIONS.SERVERS_CONTROL, PERMISSIONS.SERVERS_CREATE,
      PERMISSIONS.SERVERS_DELETE, PERMISSIONS.SERVERS_CONFIGURE,
      PERMISSIONS.RCON_USE, PERMISSIONS.PLAYERS_VIEW, PERMISSIONS.PLAYERS_MANAGE,
      PERMISSIONS.BACKUPS_VIEW, PERMISSIONS.BACKUPS_CREATE, PERMISSIONS.BACKUPS_RESTORE, PERMISSIONS.BACKUPS_DELETE,
      PERMISSIONS.MODS_MANAGE, PERMISSIONS.AUTOMATION_MANAGE,
      PERMISSIONS.APP_INSTALL, PERMISSIONS.SETTINGS_VIEW
    ]
  },
  {
    id: ROLE_IDS.OPERATOR,
    name: 'Operator',
    description: 'Day-to-day running: start and stop servers, use RCON, take backups.',
    permissions: [
      PERMISSIONS.SERVERS_VIEW, PERMISSIONS.SERVERS_CONTROL,
      PERMISSIONS.RCON_USE, PERMISSIONS.PLAYERS_VIEW, PERMISSIONS.PLAYERS_MANAGE,
      PERMISSIONS.BACKUPS_VIEW, PERMISSIONS.BACKUPS_CREATE,
      PERMISSIONS.SETTINGS_VIEW
    ]
  },
  {
    id: ROLE_IDS.VIEWER,
    name: 'Viewer',
    description: 'Read-only. Can watch status, logs and players but change nothing.',
    permissions: [
      PERMISSIONS.SERVERS_VIEW, PERMISSIONS.PLAYERS_VIEW,
      PERMISSIONS.BACKUPS_VIEW, PERMISSIONS.SETTINGS_VIEW
    ]
  }
];

/** Resolve a role's effective permissions. Admin always gets everything. */
export function effectivePermissions(role: Pick<Role, 'id' | 'permissions'> | null | undefined): Permission[] {
  if (!role) return [];
  if (role.id === ROLE_IDS.ADMIN) return [...ALL_PERMISSIONS];
  return role.permissions || [];
}

export function hasPermission(permissions: Permission[] | undefined, required: Permission): boolean {
  return !!permissions && permissions.includes(required);
}
