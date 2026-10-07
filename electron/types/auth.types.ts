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
  ACCOUNTS_VIEWERS_DELETE: 'accounts.viewers.delete',
  // Mesh. Start and stop stay on servers.control. These cover membership, placement and clusters.
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
  [PERMISSIONS.ACCOUNTS_VIEWERS_DELETE]:    { label: 'Delete viewers',         group: 'Accounts', description: 'Delete a viewer in your pool.' },
  [PERMISSIONS.NODES_VIEW]:                 { label: 'View nodes',             group: 'Mesh', description: 'See mesh nodes, health and where each server is hosted.' },
  [PERMISSIONS.NODES_ENROLL]:               { label: 'Enroll nodes',           group: 'Mesh', description: 'Admin only. Create an enrollment token so another machine can join.' },
  [PERMISSIONS.NODES_MANAGE]:               { label: 'Manage nodes',           group: 'Mesh', description: 'Rename a node or put it into maintenance.' },
  [PERMISSIONS.NODES_REMOVE]:               { label: 'Remove nodes',           group: 'Mesh', description: 'Admin only. Remove a node and revoke its certificate.' },
  [PERMISSIONS.SERVERS_MOVE]:               { label: 'Move servers',           group: 'Mesh', description: 'Move a server to another node. Healthy servers never move on their own.' },
  [PERMISSIONS.CLUSTERS_VIEW]:              { label: 'View clusters',          group: 'Mesh', description: 'See logical ARK clusters and transfer-storage health.' },
  [PERMISSIONS.CLUSTERS_MANAGE]:            { label: 'Manage clusters',        group: 'Mesh', description: 'Create clusters and choose which servers belong to them.' },
  [PERMISSIONS.CLUSTERS_STORAGE_MANAGE]:    { label: 'Manage cluster storage', group: 'Mesh', description: 'Set and validate the shared transfer path.' },
  [PERMISSIONS.MESH_VIEW]:                  { label: 'View mesh',              group: 'Mesh', description: 'See mesh health, leadership and whether the mesh is degraded.' },
  [PERMISSIONS.MESH_CONFIGURE]:             { label: 'Configure mesh',         group: 'Mesh', description: 'Create or join a mesh, and change mesh settings.' },
  [PERMISSIONS.MESH_SECURITY_MANAGE]:       { label: 'Manage mesh security',   group: 'Mesh', description: 'Change mesh-wide security settings.' }
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
  /** For a machine admin: the mesh machine it administers. Null for every other role. */
  machineNodeId?: string | null;
  /** For a machine admin: granted by a mesh admin, it may update ARK and the app on every machine. */
  updatesAnyMachine?: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

/** A user plus the resolved permissions of their role. Never carries the password hash. */
export interface AuthenticatedUser extends User {
  roleName: string;
  permissions: Permission[];
  /** Present for a mesh login. A session older than the account's current version is refused. */
  securityVersion?: number;
}

/** What the web server child knows of a client from its session cookie; main re-resolves it. */
export type SessionUser = Pick<AuthenticatedUser, 'id' | 'username' | 'displayName' | 'roleId' | 'roleName' | 'permissions' | 'active' | 'securityVersion'>;

/** The id given to a session from the single login that predates accounts. It acts as Admin. */
export const LEGACY_ADMIN_ID = 'legacy-admin';

/**
 * A well-formed cost-12 bcrypt hash that no password matches. Comparing against it costs as
 * much as a real check, so a missing account takes as long to refuse as a wrong password.
 */
export const UNMATCHABLE_BCRYPT_HASH = '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';

export const ROLE_IDS = {
  ADMIN: 'admin',
  MACHINE_ADMIN: 'machine-admin',
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
    id: ROLE_IDS.MACHINE_ADMIN,
    name: 'Machine Admin',
    description: 'Looks after one mesh machine: runs, configures and backs up every server on it, updates ARK and the app there, and moves servers between machines. Sees every server in the mesh. Cannot add or remove machines, or manage accounts.',
    permissions: [
      PERMISSIONS.SERVERS_VIEW, PERMISSIONS.SERVERS_CONTROL, PERMISSIONS.SERVERS_CREATE,
      PERMISSIONS.SERVERS_DELETE, PERMISSIONS.SERVERS_CONFIGURE, PERMISSIONS.SERVERS_MOVE,
      PERMISSIONS.RCON_USE, PERMISSIONS.PLAYERS_VIEW, PERMISSIONS.PLAYERS_MANAGE,
      PERMISSIONS.BACKUPS_VIEW, PERMISSIONS.BACKUPS_CREATE, PERMISSIONS.BACKUPS_RESTORE, PERMISSIONS.BACKUPS_DELETE,
      PERMISSIONS.MODS_MANAGE, PERMISSIONS.AUTOMATION_MANAGE, PERMISSIONS.APP_INSTALL, PERMISSIONS.SETTINGS_VIEW,
      PERMISSIONS.NODES_VIEW, PERMISSIONS.MESH_VIEW, PERMISSIONS.CLUSTERS_VIEW
    ]
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
      PERMISSIONS.ACCOUNTS_VIEWERS_CREATE, PERMISSIONS.ACCOUNTS_VIEWERS_DELETE,
      PERMISSIONS.NODES_VIEW, PERMISSIONS.MESH_VIEW, PERMISSIONS.CLUSTERS_VIEW
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

/**
 * Only an admin, the mesh admin, may bring a machine into the mesh or take one out. A custom role
 * that lists either permission does not get it.
 */
export const MESH_ADMIN_ONLY: readonly Permission[] = [PERMISSIONS.NODES_ENROLL, PERMISSIONS.NODES_REMOVE];

/**
 * Resolve a role's effective permissions. Admin always gets everything. A machine admin gets its
 * built-in set whatever is stored, since a node on an older version may hold it as a custom role.
 */
export function effectivePermissions(role: Pick<Role, 'id' | 'permissions'> | null | undefined): Permission[] {
  if (!role) return [];
  if (role.id === ROLE_IDS.ADMIN) return [...ALL_PERMISSIONS];
  const stored = role.id === ROLE_IDS.MACHINE_ADMIN
    ? BUILT_IN_ROLES.find(builtIn => builtIn.id === ROLE_IDS.MACHINE_ADMIN)!.permissions
    : role.permissions || [];
  return stored.filter(permission => !MESH_ADMIN_ONLY.includes(permission));
}
