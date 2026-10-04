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
  USERS_MANAGE: 'users.manage',
  // Separate on purpose: creating a server manager is not the same act as deleting one,
  // and neither is the same as an attendant or a viewer.
  ACCOUNTS_MANAGERS_CREATE: 'accounts.managers.create',
  ACCOUNTS_MANAGERS_DELETE: 'accounts.managers.delete',
  ACCOUNTS_ATTENDANTS_CREATE: 'accounts.attendants.create',
  ACCOUNTS_ATTENDANTS_DELETE: 'accounts.attendants.delete',
  ACCOUNTS_VIEWERS_CREATE: 'accounts.viewers.create',
  ACCOUNTS_VIEWERS_DELETE: 'accounts.viewers.delete'
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
  [PERMISSIONS.USERS_MANAGE]:      { label: 'Manage roles',        group: 'Application', description: 'Create operators and edit what each role is allowed to do. Admin only.' },
  [PERMISSIONS.ACCOUNTS_MANAGERS_CREATE]:   { label: 'Add server managers',    group: 'Accounts', description: 'Create a server manager in your own group.' },
  [PERMISSIONS.ACCOUNTS_MANAGERS_DELETE]:   { label: 'Delete server managers', group: 'Accounts', description: 'Delete a server manager in your own group.' },
  [PERMISSIONS.ACCOUNTS_ATTENDANTS_CREATE]: { label: 'Add attendants',         group: 'Accounts', description: 'Create an attendant in your own group.' },
  [PERMISSIONS.ACCOUNTS_ATTENDANTS_DELETE]: { label: 'Delete attendants',      group: 'Accounts', description: 'Delete an attendant in your own group.' },
  [PERMISSIONS.ACCOUNTS_VIEWERS_CREATE]:    { label: 'Add viewers',            group: 'Accounts', description: 'Create a viewer in your own group.' },
  [PERMISSIONS.ACCOUNTS_VIEWERS_DELETE]:    { label: 'Delete viewers',         group: 'Accounts', description: 'Delete a viewer in your own group.' }
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
  /**
   * The operator this account belongs to. Null means the admin pool.
   * Operators themselves are owned by the admin, so this stays null for them.
   */
  ownerUserId: string | null;
  /** Set when this account's password comes from the process command line. */
  cliLocked: boolean;
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
  ATTENDANT: 'attendant',
  VIEWER: 'viewer'
} as const;

/** A server is assigned to one person, who is either a server manager or an attendant. */
export function isAssignableRole(roleId: string | null | undefined): boolean {
  return roleId === ROLE_IDS.SERVER_MANAGER || roleId === ROLE_IDS.ATTENDANT;
}

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
    description: 'Runs the servers assigned to them, including settings, mods, players, and backups. Cannot add or delete servers, manage accounts, or change application settings.',
    permissions: [
      PERMISSIONS.SERVERS_VIEW, PERMISSIONS.SERVERS_CONTROL, PERMISSIONS.SERVERS_CONFIGURE,
      PERMISSIONS.RCON_USE, PERMISSIONS.PLAYERS_VIEW, PERMISSIONS.PLAYERS_MANAGE,
      PERMISSIONS.BACKUPS_VIEW, PERMISSIONS.BACKUPS_CREATE, PERMISSIONS.BACKUPS_RESTORE, PERMISSIONS.BACKUPS_DELETE,
      PERMISSIONS.MODS_MANAGE, PERMISSIONS.AUTOMATION_MANAGE
    ]
  },
  {
    id: ROLE_IDS.OPERATOR,
    name: 'Operator',
    description: 'Runs one group. Can do everything a server manager can, and can also add and delete servers and the server managers, attendants, and viewers in that group. Cannot see another operator\'s group, create operators, or change application settings.',
    permissions: [
      PERMISSIONS.SERVERS_VIEW, PERMISSIONS.SERVERS_CONTROL, PERMISSIONS.SERVERS_CREATE, PERMISSIONS.SERVERS_DELETE, PERMISSIONS.SERVERS_CONFIGURE,
      PERMISSIONS.RCON_USE, PERMISSIONS.PLAYERS_VIEW, PERMISSIONS.PLAYERS_MANAGE,
      PERMISSIONS.BACKUPS_VIEW, PERMISSIONS.BACKUPS_CREATE, PERMISSIONS.BACKUPS_RESTORE, PERMISSIONS.BACKUPS_DELETE,
      PERMISSIONS.MODS_MANAGE, PERMISSIONS.AUTOMATION_MANAGE,
      PERMISSIONS.ACCOUNTS_MANAGERS_CREATE, PERMISSIONS.ACCOUNTS_MANAGERS_DELETE,
      PERMISSIONS.ACCOUNTS_ATTENDANTS_CREATE, PERMISSIONS.ACCOUNTS_ATTENDANTS_DELETE,
      PERMISSIONS.ACCOUNTS_VIEWERS_CREATE, PERMISSIONS.ACCOUNTS_VIEWERS_DELETE
    ]
  },
  {
    id: ROLE_IDS.ATTENDANT,
    name: 'Attendant',
    description: 'Can start, stop, and read the console of the servers assigned to them. Cannot change settings, send commands, or add servers.',
    permissions: [
      PERMISSIONS.SERVERS_VIEW, PERMISSIONS.SERVERS_CONTROL
    ]
  },
  {
    id: ROLE_IDS.VIEWER,
    name: 'Viewer',
    description: 'Read-only inside one operator group. Can watch status, the console, and players. Cannot change anything, take backups, or open application settings.',
    permissions: [
      PERMISSIONS.SERVERS_VIEW, PERMISSIONS.PLAYERS_VIEW
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
