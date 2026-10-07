import { PERMISSIONS, Permission } from '../../types/auth.types';

/**
 * What each message channel requires.
 *
 * The message bus is the app's whole API: the web UI can reach every channel over the
 * WebSocket, so this map is the authorization boundary. It is deny-by-default: a channel
 * missing from here is refused for everyone except a full Admin, so adding a handler
 * without adding an entry fails closed rather than open.
 *
 * `null` marks a channel that any signed-in user may call regardless of role (currently
 * only the handshake-ish reads the UI needs to render at all).
 *
 * An object rule names the permission (or several, any one of which is enough) and, for a
 * call about one server, the payload key that carries the server's id. The gate reads that
 * key and refuses the call when the server is outside the caller's pool, so no handler has
 * to check and nothing is guessed from payload shapes.
 */

/** Where a channel's payload names the server(s) the call is about. */
export type InstanceKey = 'id' | 'instanceId' | 'serverId' | 'targetId' | 'orderedIds' | 'instance.id';

export type ChannelRule =
  | Permission
  | null
  | {
      permission?: Permission;
      anyOf?: Permission[];
      instance?: InstanceKey;
    };

/** Any one of these opens the account channels; the handler then limits what the caller may do. */
export const ACCOUNT_CHANNEL_PERMISSIONS: Permission[] = [
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.ACCOUNTS_MANAGERS_CREATE, PERMISSIONS.ACCOUNTS_MANAGERS_DELETE,
  PERMISSIONS.ACCOUNTS_ATTENDANTS_CREATE, PERMISSIONS.ACCOUNTS_ATTENDANTS_DELETE,
  PERMISSIONS.ACCOUNTS_VIEWERS_CREATE, PERMISSIONS.ACCOUNTS_VIEWERS_DELETE
];

const byId = (permission: Permission): ChannelRule => ({ permission, instance: 'id' });
const byInstanceId = (permission: Permission): ChannelRule => ({ permission, instance: 'instanceId' });
const byServerId = (permission: Permission): ChannelRule => ({ permission, instance: 'serverId' });

export const CHANNEL_PERMISSIONS: Record<string, ChannelRule> = {
  // Reads every signed-in user needs
  'get-system-info': null,
  'get-log-file-path': null,
  'get-host-resources': null,
  'get-player-history': null,
  'check-firewall-enabled': null,
  // The activity feed is shared; anyone signed in may read it, but clearing it removes
  // history for everyone, so that needs the settings permission.
  'get-activity': null,
  'clear-activity': PERMISSIONS.SETTINGS_MANAGE,

  // Servers: reading
  'get-server-instances': PERMISSIONS.SERVERS_VIEW,
  'get-server-instance': byId(PERMISSIONS.SERVERS_VIEW),
  'get-server-instance-state': byId(PERMISSIONS.SERVERS_VIEW),
  'get-server-instance-logs': byId(PERMISSIONS.SERVERS_VIEW),
  'get-server-instance-players': byId(PERMISSIONS.SERVERS_VIEW),
  'get-rcon-status': byId(PERMISSIONS.SERVERS_VIEW),
  'get-ini-file': byInstanceId(PERMISSIONS.SERVERS_VIEW),
  'list-pool-labels': PERMISSIONS.SERVERS_VIEW,

  // Servers: control
  'start-server-instance': byId(PERMISSIONS.SERVERS_CONTROL),
  'stop-server-instance': byId(PERMISSIONS.SERVERS_CONTROL),
  'force-stop-server-instance': byId(PERMISSIONS.SERVERS_CONTROL),
  'start-all-instances': PERMISSIONS.SERVERS_CONTROL,
  'stop-all-instances': PERMISSIONS.SERVERS_CONTROL,
  'connect-rcon': byId(PERMISSIONS.SERVERS_CONTROL),
  'disconnect-rcon': byId(PERMISSIONS.SERVERS_CONTROL),

  // Servers: lifecycle and configuration
  // Adding a server and editing one share this channel: creating needs servers.create and
  // editing needs servers.configure. The handler refuses the half the caller lacks.
  'save-server-instance': { anyOf: [PERMISSIONS.SERVERS_CREATE, PERMISSIONS.SERVERS_CONFIGURE], instance: 'instance.id' },
  'save-ini-file': byInstanceId(PERMISSIONS.SERVERS_CONFIGURE),
  'reorder-server-instances': { permission: PERMISSIONS.SERVERS_CONFIGURE, instance: 'orderedIds' },
  'export-server-config': byId(PERMISSIONS.SERVERS_CONFIGURE),
  'import-server-config': { permission: PERMISSIONS.SERVERS_CONFIGURE, instance: 'targetId' },
  'setup-ark-server-firewall': PERMISSIONS.SERVERS_CONFIGURE,
  'setup-web-server-firewall': PERMISSIONS.SERVERS_CONFIGURE,
  'get-linux-firewall-instructions': PERMISSIONS.SERVERS_CONFIGURE,
  'open-directory': byId(PERMISSIONS.SERVERS_CONFIGURE),
  'select-directory': PERMISSIONS.SERVERS_CONFIGURE,
  'test-directory-access': PERMISSIONS.SERVERS_CONFIGURE,
  'delete-server-instance': byId(PERMISSIONS.SERVERS_DELETE),
  'import-server-from-backup': PERMISSIONS.SERVERS_CREATE,
  // Attaching a server manager to a server is the pool owner's job; set-server-operator moves
  // a server between pools and has no entry, so only an admin may call it.
  'assign-server-manager': byInstanceId(PERMISSIONS.SERVERS_CREATE),

  // RCON and players
  'rcon-command': byId(PERMISSIONS.RCON_USE),
  'get-online-players': byId(PERMISSIONS.PLAYERS_VIEW),
  'load-whitelist': byInstanceId(PERMISSIONS.PLAYERS_VIEW),
  'add-to-whitelist': byInstanceId(PERMISSIONS.PLAYERS_MANAGE),
  'remove-from-whitelist': byInstanceId(PERMISSIONS.PLAYERS_MANAGE),
  'clear-whitelist': byInstanceId(PERMISSIONS.PLAYERS_MANAGE),

  // Backups
  'get-backup-list': byInstanceId(PERMISSIONS.BACKUPS_VIEW),
  'get-backup-settings': byInstanceId(PERMISSIONS.BACKUPS_VIEW),
  'get-scheduler-status': byInstanceId(PERMISSIONS.BACKUPS_VIEW),
  'download-backup': byInstanceId(PERMISSIONS.BACKUPS_VIEW),
  'create-backup': byInstanceId(PERMISSIONS.BACKUPS_CREATE),
  'save-backup-settings': byInstanceId(PERMISSIONS.BACKUPS_CREATE),
  'start-backup-scheduler': byInstanceId(PERMISSIONS.BACKUPS_CREATE),
  'stop-backup-scheduler': byInstanceId(PERMISSIONS.BACKUPS_CREATE),
  'restore-backup': byInstanceId(PERMISSIONS.BACKUPS_RESTORE),
  'delete-backup': byInstanceId(PERMISSIONS.BACKUPS_DELETE),

  // Mods and plugins
  'curseforge-search-mods': PERMISSIONS.MODS_MANAGE,
  'curseforge-get-mod': PERMISSIONS.MODS_MANAGE,
  'curseforge-open-website': PERMISSIONS.MODS_MANAGE,
  'get-asaapi-status': byInstanceId(PERMISSIONS.MODS_MANAGE),
  'get-asaapi-latest': PERMISSIONS.MODS_MANAGE,
  'list-ark-api-plugins': byInstanceId(PERMISSIONS.MODS_MANAGE),
  'download-asaapi': byInstanceId(PERMISSIONS.MODS_MANAGE),
  'remove-ark-api-plugin': byInstanceId(PERMISSIONS.MODS_MANAGE),
  'install-plugin-from-zip': byInstanceId(PERMISSIONS.MODS_MANAGE),
  'install-plugin-from-url': byInstanceId(PERMISSIONS.MODS_MANAGE),

  // Automation
  'get-automation-status': byServerId(PERMISSIONS.AUTOMATION_MANAGE),
  'configure-autostart': byServerId(PERMISSIONS.AUTOMATION_MANAGE),
  'configure-crash-detection': byServerId(PERMISSIONS.AUTOMATION_MANAGE),
  'configure-scheduled-restart': byServerId(PERMISSIONS.AUTOMATION_MANAGE),
  'configure-discord-webhook': byServerId(PERMISSIONS.AUTOMATION_MANAGE),
  'configure-broadcasts': byServerId(PERMISSIONS.AUTOMATION_MANAGE),
  'auto-start-on-app-launch': PERMISSIONS.AUTOMATION_MANAGE,

  // Installation
  'install': PERMISSIONS.APP_INSTALL,
  'cancel-install': PERMISSIONS.APP_INSTALL,
  'check-install-requirements': PERMISSIONS.APP_INSTALL,
  'check-ark-update': PERMISSIONS.APP_INSTALL,
  // Reading what is installed is not a privileged action; installing it is. Every page asks on load.
  'get-ark-installation': null,
  'check-linux-deps': PERMISSIONS.APP_INSTALL,
  'get-linux-deps-list': PERMISSIONS.APP_INSTALL,
  'install-linux-deps': PERMISSIONS.APP_INSTALL,
  'validate-sudo-password': PERMISSIONS.APP_INSTALL,
  'check-for-app-update': PERMISSIONS.APP_INSTALL,
  // Every page asks for this on load, and attendants and viewers hold no settings permission.
  'get-app-update-status': null,
  'download-app-update': PERMISSIONS.APP_INSTALL,
  'install-app-update': PERMISSIONS.APP_INSTALL,

  // Application settings
  // The public config (password stripped) is already broadcast to every client on each change.
  'get-global-config': null,
  'open-config-directory': PERMISSIONS.SETTINGS_VIEW,
  'set-global-config': PERMISSIONS.SETTINGS_MANAGE,
  'start-web-server': PERMISSIONS.SETTINGS_MANAGE,
  'stop-web-server': PERMISSIONS.SETTINGS_MANAGE,
  'web-server-status': PERMISSIONS.SETTINGS_VIEW,

  // Accounts. Roles are edited by users.manage holders only; the account channels also open to
  // pool owners, and the handler limits them to their own pool.
  'get-users': { anyOf: ACCOUNT_CHANNEL_PERMISSIONS },
  'create-user': { anyOf: ACCOUNT_CHANNEL_PERMISSIONS },
  'update-user': { anyOf: ACCOUNT_CHANNEL_PERMISSIONS },
  'delete-user': { anyOf: ACCOUNT_CHANNEL_PERMISSIONS },
  'get-roles': { anyOf: ACCOUNT_CHANNEL_PERMISSIONS },
  'create-role': PERMISSIONS.USERS_MANAGE,
  'update-role': PERMISSIONS.USERS_MANAGE,
  'delete-role': PERMISSIONS.USERS_MANAGE,
  // Reading your own identity is not a privilege; every signed-in user needs it.
  'get-current-user': null,
  'change-own-password': null,

  // Mesh. get-mesh-status and mesh-login are also allowed for a desktop window that has not
  // signed in yet; see authorizeChannel. Unknown channels stay admin-only.
  'get-mesh-status': null,
  'mesh-login': null,
  'mesh-logout': null,
  'mesh-bootstrap-admin': null,
  'create-mesh': PERMISSIONS.MESH_CONFIGURE,
  'join-mesh': PERMISSIONS.MESH_CONFIGURE,
  'create-enrollment-token': PERMISSIONS.NODES_ENROLL,
  'remove-mesh-node': PERMISSIONS.NODES_REMOVE,
  'get-mesh-nodes': PERMISSIONS.NODES_VIEW,
  'set-node-maintenance': PERMISSIONS.NODES_MANAGE,
  'rename-mesh-node': PERMISSIONS.NODES_MANAGE,
  'set-mesh-node-address': PERMISSIONS.NODES_MANAGE,
  'create-cluster': PERMISSIONS.CLUSTERS_MANAGE,
  'get-clusters': PERMISSIONS.CLUSTERS_VIEW,
  'rename-cluster': PERMISSIONS.CLUSTERS_MANAGE,
  'delete-cluster': PERMISSIONS.CLUSTERS_MANAGE,
  'set-cluster-upload-notices': PERMISSIONS.CLUSTERS_MANAGE,
  'validate-cluster-storage': PERMISSIONS.CLUSTERS_STORAGE_MANAGE,
  'move-server': byServerId(PERMISSIONS.SERVERS_MOVE),
  'suggest-placement': PERMISSIONS.SERVERS_CREATE,
  'mesh-diagnostics': PERMISSIONS.MESH_VIEW,
  'mesh-wireguard': PERMISSIONS.MESH_CONFIGURE,
  'mesh-wireguard-apply': PERMISSIONS.MESH_CONFIGURE,
  'mesh-node-update': PERMISSIONS.APP_INSTALL,
  'backup-mesh': PERMISSIONS.MESH_CONFIGURE,
  'restart-server-instance': byId(PERMISSIONS.SERVERS_CONTROL),
  'get-mesh-audit': PERMISSIONS.MESH_VIEW
};

function ruleFor(channel: string): ChannelRule | undefined {
  // Own entries only: a plain lookup would find 'constructor' and friends on Object.prototype.
  return Object.prototype.hasOwnProperty.call(CHANNEL_PERMISSIONS, channel) ? CHANNEL_PERMISSIONS[channel] : undefined;
}

/**
 * The permission a channel needs, for the refusal text: the first of several when any is enough.
 *
 * Returns `undefined` for a channel with no entry, which callers must treat as
 * "admin only"; see the deny-by-default note above.
 */
export function permissionForChannel(channel: string): Permission | null | undefined {
  const rule = ruleFor(channel);
  if (rule === undefined || rule === null || typeof rule === 'string') return rule;
  return rule.permission ?? rule.anyOf?.[0] ?? null;
}

/** The payload key naming the server(s) a channel acts on, when the channel declares one. */
export function instanceKeyForChannel(channel: string): InstanceKey | undefined {
  const rule = ruleFor(channel);
  return rule && typeof rule === 'object' ? rule.instance : undefined;
}

/** True when a channel is known and callable with the given permissions. */
export function isChannelAllowed(channel: string, permissions: Permission[], isAdmin: boolean): boolean {
  if (isAdmin) return true;
  const rule = ruleFor(channel);
  if (rule === undefined) return false;   // unknown channel: deny
  if (rule === null) return true;         // available to any signed-in user
  if (typeof rule === 'string') return permissions.includes(rule);
  const accepted = rule.anyOf ?? (rule.permission ? [rule.permission] : []);
  // An object rule that names no permission is a mistake; fail closed.
  return accepted.some(permission => permissions.includes(permission));
}
