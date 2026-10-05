/**
 * Users, roles and permissions.
 *
 * Shared by the main process (which owns the database and enforces permissions on the
 * message bus) and the web-server child process (which authenticates logins). The renderer
 * has its own mirror of the same vocabulary in src/app/core/models/auth.model.ts; keep the
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
  // Pool accounts. Creating a server manager is not the same act as deleting one, and neither is
  // the same as an attendant or a viewer, so each is its own permission.
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
  [PERMISSIONS.USERS_MANAGE]:      { label: 'Manage roles and all accounts', group: 'Application', description: 'Edit roles, and manage any account whose permissions you hold.' },
  [PERMISSIONS.ACCOUNTS_MANAGERS_CREATE]:   { label: 'Add server managers',    group: 'Accounts', description: 'Add or edit a server manager in your pool.' },
  [PERMISSIONS.ACCOUNTS_MANAGERS_DELETE]:   { label: 'Delete server managers', group: 'Accounts', description: 'Delete a server manager in your pool.' },
  [PERMISSIONS.ACCOUNTS_ATTENDANTS_CREATE]: { label: 'Add attendants',         group: 'Accounts', description: 'Add or edit an attendant in your pool.' },
  [PERMISSIONS.ACCOUNTS_ATTENDANTS_DELETE]: { label: 'Delete attendants',      group: 'Accounts', description: 'Delete an attendant in your pool.' },
  [PERMISSIONS.ACCOUNTS_VIEWERS_CREATE]:    { label: 'Add viewers',            group: 'Accounts', description: 'Add or edit a viewer in your pool.' },
  [PERMISSIONS.ACCOUNTS_VIEWERS_DELETE]:    { label: 'Delete viewers',         group: 'Accounts', description: 'Delete a viewer in your pool.' }
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
   * The operator whose pool this account is in. Null is the admin pool. Admin and operator
   * accounts are never owned, so it is always null for them.
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

/** What the web server child knows of a client from its session cookie; main re-resolves it. */
export type SessionUser = Pick<AuthenticatedUser, 'id' | 'username' | 'displayName' | 'roleId' | 'roleName' | 'permissions' | 'active'>;

/** The id given to a session from the single login that predates accounts. It acts as Admin. */
export const LEGACY_ADMIN_ID = 'legacy-admin';

/**
 * A well-formed cost-12 bcrypt hash that no password matches. Comparing against it costs as
 * much as a real check, so a missing account takes as long to refuse as a wrong password.
 */
export const UNMATCHABLE_BCRYPT_HASH = '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';

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

/** A name shown for an operator or an assignee, without anything private. */
export interface PoolLabel {
  id: string;
  username: string;
  displayName: string;
  roleName: string;
  /** For an assignee, the operator whose pool they are in; null is the admin pool. */
  ownerUserId?: string | null;
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
    id: ROLE_IDS.OPERATOR,
    name: 'Operator',
    description: 'Runs one pool: adds and deletes its servers, runs them, and manages the server managers, attendants and viewers in it. Cannot see another pool, create operators or change application settings.',
    permissions: [
      PERMISSIONS.SERVERS_VIEW, PERMISSIONS.SERVERS_CONTROL, PERMISSIONS.SERVERS_CREATE,
      PERMISSIONS.SERVERS_DELETE, PERMISSIONS.SERVERS_CONFIGURE,
      PERMISSIONS.RCON_USE, PERMISSIONS.PLAYERS_VIEW, PERMISSIONS.PLAYERS_MANAGE,
      PERMISSIONS.BACKUPS_VIEW, PERMISSIONS.BACKUPS_CREATE, PERMISSIONS.BACKUPS_RESTORE, PERMISSIONS.BACKUPS_DELETE,
      PERMISSIONS.MODS_MANAGE, PERMISSIONS.AUTOMATION_MANAGE,
      PERMISSIONS.ACCOUNTS_MANAGERS_CREATE, PERMISSIONS.ACCOUNTS_MANAGERS_DELETE,
      PERMISSIONS.ACCOUNTS_ATTENDANTS_CREATE, PERMISSIONS.ACCOUNTS_ATTENDANTS_DELETE,
      PERMISSIONS.ACCOUNTS_VIEWERS_CREATE, PERMISSIONS.ACCOUNTS_VIEWERS_DELETE
    ]
  },
  {
    id: ROLE_IDS.SERVER_MANAGER,
    name: 'Server Manager',
    description: 'Runs the servers assigned to them: settings, mods, players and backups. Cannot add or delete servers, manage accounts or change application settings.',
    permissions: [
      PERMISSIONS.SERVERS_VIEW, PERMISSIONS.SERVERS_CONTROL, PERMISSIONS.SERVERS_CONFIGURE,
      PERMISSIONS.RCON_USE, PERMISSIONS.PLAYERS_VIEW, PERMISSIONS.PLAYERS_MANAGE,
      PERMISSIONS.BACKUPS_VIEW, PERMISSIONS.BACKUPS_CREATE, PERMISSIONS.BACKUPS_RESTORE, PERMISSIONS.BACKUPS_DELETE,
      PERMISSIONS.MODS_MANAGE, PERMISSIONS.AUTOMATION_MANAGE
    ]
  },
  {
    id: ROLE_IDS.ATTENDANT,
    name: 'Attendant',
    description: 'Can start, stop, read the console and see who is connected on the servers assigned to them. Cannot change settings, send commands or add servers.',
    permissions: [
      PERMISSIONS.SERVERS_VIEW, PERMISSIONS.SERVERS_CONTROL, PERMISSIONS.PLAYERS_VIEW
    ]
  },
  {
    id: ROLE_IDS.VIEWER,
    name: 'Viewer',
    description: 'Read-only inside one pool. Can watch status, the console and players. Cannot change anything, take backups or open application settings.',
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
