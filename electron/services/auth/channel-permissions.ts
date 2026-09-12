import { PERMISSIONS, Permission } from '../../types/auth.types';

/**
 * What each message channel requires.
 *
 * The message bus is the app's whole API: the web UI can reach every channel over the
 * WebSocket, so this map is the authorization boundary. It is deny-by-default — a channel
 * missing from here is refused for everyone except a full Admin, so adding a handler
 * without adding an entry fails closed rather than open.
 *
 * `null` marks a channel that any signed-in user may call regardless of role (currently
 * only the handshake-ish reads the UI needs to render at all).
 */
export const CHANNEL_PERMISSIONS: Record<string, Permission | null> = {
  // ---- Reads every signed-in user needs ----
  'get-system-info': null,
  'get-log-file-path': null,
  'get-host-resources': null,
  'get-player-history': null,
  'check-firewall-enabled': null,
  // The activity feed is shared; anyone signed in may read it, but clearing it removes
  // history for everyone, so that needs the settings permission.
  'get-activity': null,
  'clear-activity': PERMISSIONS.SETTINGS_MANAGE,

  // ---- Servers: reading ----
  'get-server-instances': PERMISSIONS.SERVERS_VIEW,
  'get-server-instance': PERMISSIONS.SERVERS_VIEW,
  'get-server-instance-state': PERMISSIONS.SERVERS_VIEW,
  'get-server-instance-logs': PERMISSIONS.SERVERS_VIEW,
  'get-server-instance-players': PERMISSIONS.SERVERS_VIEW,
  'get-rcon-status': PERMISSIONS.SERVERS_VIEW,
  'get-ini-file': PERMISSIONS.SERVERS_VIEW,

  // ---- Servers: control ----
  'start-server-instance': PERMISSIONS.SERVERS_CONTROL,
  'force-stop-server-instance': PERMISSIONS.SERVERS_CONTROL,
  'start-all-instances': PERMISSIONS.SERVERS_CONTROL,
  'stop-all-instances': PERMISSIONS.SERVERS_CONTROL,
  'connect-rcon': PERMISSIONS.SERVERS_CONTROL,
  'disconnect-rcon': PERMISSIONS.SERVERS_CONTROL,

  // ---- Servers: lifecycle and configuration ----
  'save-server-instance': PERMISSIONS.SERVERS_CONFIGURE,
  'save-ini-file': PERMISSIONS.SERVERS_CONFIGURE,
  'reorder-server-instances': PERMISSIONS.SERVERS_CONFIGURE,
  'export-server-config': PERMISSIONS.SERVERS_CONFIGURE,
  'import-server-config': PERMISSIONS.SERVERS_CONFIGURE,
  'setup-ark-server-firewall': PERMISSIONS.SERVERS_CONFIGURE,
  'setup-web-server-firewall': PERMISSIONS.SERVERS_CONFIGURE,
  'get-linux-firewall-instructions': PERMISSIONS.SERVERS_CONFIGURE,
  'open-directory': PERMISSIONS.SERVERS_CONFIGURE,
  'select-directory': PERMISSIONS.SERVERS_CONFIGURE,
  'test-directory-access': PERMISSIONS.SERVERS_CONFIGURE,
  'delete-server-instance': PERMISSIONS.SERVERS_DELETE,
  'import-server-from-backup': PERMISSIONS.SERVERS_CREATE,

  // ---- RCON and players ----
  'rcon-command': PERMISSIONS.RCON_USE,
  'get-online-players': PERMISSIONS.PLAYERS_VIEW,
  'load-whitelist': PERMISSIONS.PLAYERS_VIEW,
  'add-to-whitelist': PERMISSIONS.PLAYERS_MANAGE,
  'remove-from-whitelist': PERMISSIONS.PLAYERS_MANAGE,
  'clear-whitelist': PERMISSIONS.PLAYERS_MANAGE,

  // ---- Backups ----
  'get-backup-list': PERMISSIONS.BACKUPS_VIEW,
  'get-backup-settings': PERMISSIONS.BACKUPS_VIEW,
  'get-scheduler-status': PERMISSIONS.BACKUPS_VIEW,
  'download-backup': PERMISSIONS.BACKUPS_VIEW,
  'create-backup': PERMISSIONS.BACKUPS_CREATE,
  'save-backup-settings': PERMISSIONS.BACKUPS_CREATE,
  'start-backup-scheduler': PERMISSIONS.BACKUPS_CREATE,
  'stop-backup-scheduler': PERMISSIONS.BACKUPS_CREATE,
  'restore-backup': PERMISSIONS.BACKUPS_RESTORE,
  'delete-backup': PERMISSIONS.BACKUPS_DELETE,

  // ---- Mods and plugins ----
  'curseforge-search-mods': PERMISSIONS.MODS_MANAGE,
  'curseforge-get-mod': PERMISSIONS.MODS_MANAGE,
  'curseforge-open-website': PERMISSIONS.MODS_MANAGE,
  'get-asaapi-status': PERMISSIONS.MODS_MANAGE,
  'get-asaapi-latest': PERMISSIONS.MODS_MANAGE,
  'list-ark-api-plugins': PERMISSIONS.MODS_MANAGE,
  'download-asaapi': PERMISSIONS.MODS_MANAGE,
  'remove-ark-api-plugin': PERMISSIONS.MODS_MANAGE,
  'install-plugin-from-zip': PERMISSIONS.MODS_MANAGE,
  'install-plugin-from-url': PERMISSIONS.MODS_MANAGE,

  // ---- Automation ----
  'get-automation-status': PERMISSIONS.AUTOMATION_MANAGE,
  'configure-autostart': PERMISSIONS.AUTOMATION_MANAGE,
  'configure-crash-detection': PERMISSIONS.AUTOMATION_MANAGE,
  'configure-scheduled-restart': PERMISSIONS.AUTOMATION_MANAGE,
  'configure-discord-webhook': PERMISSIONS.AUTOMATION_MANAGE,
  'configure-broadcasts': PERMISSIONS.AUTOMATION_MANAGE,
  'auto-start-on-app-launch': PERMISSIONS.AUTOMATION_MANAGE,

  // ---- Installation ----
  'install': PERMISSIONS.APP_INSTALL,
  'cancel-install': PERMISSIONS.APP_INSTALL,
  'check-install-requirements': PERMISSIONS.APP_INSTALL,
  'check-ark-update': PERMISSIONS.APP_INSTALL,
  // Reading what is installed is not a privileged action; installing it is.
  'get-ark-installation': PERMISSIONS.SETTINGS_VIEW,
  'check-linux-deps': PERMISSIONS.APP_INSTALL,
  'get-linux-deps-list': PERMISSIONS.APP_INSTALL,
  'install-linux-deps': PERMISSIONS.APP_INSTALL,
  'validate-sudo-password': PERMISSIONS.APP_INSTALL,
  'check-for-app-update': PERMISSIONS.APP_INSTALL,
  'get-app-update-status': PERMISSIONS.APP_INSTALL,
  'download-app-update': PERMISSIONS.APP_INSTALL,
  'install-app-update': PERMISSIONS.APP_INSTALL,

  // ---- Application settings ----
  'get-global-config': PERMISSIONS.SETTINGS_VIEW,
  'open-config-directory': PERMISSIONS.SETTINGS_VIEW,
  'set-global-config': PERMISSIONS.SETTINGS_MANAGE,
  'start-web-server': PERMISSIONS.SETTINGS_MANAGE,
  'stop-web-server': PERMISSIONS.SETTINGS_MANAGE,
  'web-server-status': PERMISSIONS.SETTINGS_VIEW,

  // ---- Accounts ----
  'get-users': PERMISSIONS.USERS_MANAGE,
  'create-user': PERMISSIONS.USERS_MANAGE,
  'update-user': PERMISSIONS.USERS_MANAGE,
  'delete-user': PERMISSIONS.USERS_MANAGE,
  'get-roles': PERMISSIONS.USERS_MANAGE,
  'create-role': PERMISSIONS.USERS_MANAGE,
  'update-role': PERMISSIONS.USERS_MANAGE,
  'delete-role': PERMISSIONS.USERS_MANAGE,
  // Reading your own identity is not a privilege; every signed-in user needs it.
  'get-current-user': null,
  'change-own-password': null
};

/**
 * The permission a channel needs.
 *
 * Returns `undefined` for a channel with no entry, which callers must treat as
 * "admin only" — see the deny-by-default note above.
 */
export function permissionForChannel(channel: string): Permission | null | undefined {
  return CHANNEL_PERMISSIONS[channel];
}

/** True when a channel is known and callable with the given permissions. */
export function isChannelAllowed(channel: string, permissions: Permission[], isAdmin: boolean): boolean {
  if (isAdmin) return true;
  const required = permissionForChannel(channel);
  if (required === undefined) return false;   // unknown channel: deny
  if (required === null) return true;         // available to any signed-in user
  return permissions.includes(required);
}
