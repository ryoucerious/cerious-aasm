import { userDatabaseService } from './auth/user-database.service';

export type ActivityKind =
  | 'start' | 'stop' | 'crash' | 'backup' | 'join' | 'leave' | 'update' | 'error' | 'info' | 'account';

export interface ActivityEntry {
  id: number;
  kind: ActivityKind;
  message: string;
  instanceId: string | null;
  username: string | null;
  createdAt: number;
}

/** How many entries to keep. Trimmed on write so the table cannot grow without bound. */
const MAX_ENTRIES = 500;

/**
 * How long an action stays associated with its actor.
 *
 * A request like start-server-instance is answered immediately, but the event it causes
 * ("Ragnarok started") arrives seconds later on a different channel. Remembering the caller
 * for a short window lets the outcome name them, while anything that happens later with
 * nobody asking — a crash, a scheduled restart — correctly has no actor.
 */
const ACTOR_TTL_MS = 90_000;

/**
 * Channels worth recording in their own right, because they change something without
 * producing a state broadcast the feed would otherwise notice.
 */
const ACTION_MESSAGES: Record<string, (payload: any) => string> = {
  'save-server-instance': () => 'Server settings changed',
  'save-ini-file': (p) => `Edited ${p?.filename || 'an INI file'}`,
  'rcon-command': (p) => `Ran RCON command: ${String(p?.command || '').slice(0, 80)}`,
  'restore-backup': () => 'Restored a backup',
  'delete-backup': () => 'Deleted a backup',
  'save-backup-settings': () => 'Backup schedule changed',
  'set-global-config': () => 'Application settings changed',
  'install': (p) => `Started installing ${p?.target || 'the ARK server'}`,
  'create-user': (p) => `Created the user "${p?.username || ''}"`,
  'update-user': () => 'Updated a user account',
  'delete-user': () => 'Deleted a user account',
  'create-role': (p) => `Created the role "${p?.name || ''}"`,
  'update-role': (p) => `Updated the role "${p?.name || ''}"`,
  'delete-role': () => 'Deleted a role',
  'add-to-whitelist': () => 'Added a player to the whitelist',
  'remove-from-whitelist': () => 'Removed a player from the whitelist',
  'clear-whitelist': () => 'Cleared the whitelist'
};

/** Which kind of entry an attributed action produces. */
const ACTION_KINDS: Record<string, ActivityKind> = {
  'create-user': 'account',
  'update-user': 'account',
  'delete-user': 'account',
  'create-role': 'account',
  'update-role': 'account',
  'delete-role': 'account',
  'restore-backup': 'backup',
  'delete-backup': 'backup',
  'save-backup-settings': 'backup'
};

/**
 * The Recent Activity feed, recorded server-side.
 *
 * It used to be assembled in the browser and cached per device, so each machine saw a
 * different history and anything that happened while no UI was open was lost. Recording it
 * here means the feed is shared by everyone, survives restarts, and captures events that
 * occur with nobody watching — a scheduled backup, or a server crashing overnight.
 *
 * Events are picked up from the broadcasts the app already sends, so nothing at the call
 * sites had to change: {@link recordFromBroadcast} is handed every outgoing message and
 * keeps the few that are worth remembering.
 */
export class ActivityLogService {
  /** Last seen state per instance, so a repeated broadcast is not logged twice. */
  private lastState: Record<string, string> = {};
  /** Who last asked for something, per instance and globally, with the time they asked. */
  private recentActors: Record<string, { username: string; at: number }> = {};
  /** Last seen player count per instance, to turn counts into join/leave events. */
  private lastPlayers: Record<string, number> = {};
  private instanceNames: Record<string, string> = {};

  /** Remember instance names so messages can say "Ragnarok" rather than a uuid. */
  noteInstanceNames(instances: { id: string; name: string }[]): void {
    for (const instance of instances || []) {
      if (instance?.id) this.instanceNames[instance.id] = instance.name || instance.id;
    }
  }

  private nameOf(instanceId: string | null | undefined): string {
    if (!instanceId) return 'Server';
    return this.instanceNames[instanceId] || 'Server';
  }

  /**
   * Note that someone asked for something, and record the action itself when it is one that
   * would otherwise leave no trace. Called for every authorized message, so it stays cheap.
   *
   * `username` is null for the desktop app, which is the machine owner rather than an
   * account; those entries are left unattributed rather than invented.
   */
  noteAction(channel: string, payload: any, username: string | null): void {
    try {
      const instanceId = this.instanceIdFrom(payload);
      if (username) {
        const at = Date.now();
        this.recentActors[instanceId || '*'] = { username, at };
        // Also remember it globally, so an action on one server can still attribute a
        // broadcast that arrives without an instance id.
        this.recentActors['*'] = { username, at };
      }

      const describe = ACTION_MESSAGES[channel];
      if (describe) {
        const suffix = instanceId ? ` (${this.nameOf(instanceId)})` : '';
        this.record(ACTION_KINDS[channel] || 'info', `${describe(payload)}${suffix}`, instanceId, username);
      }
    } catch (error) {
      console.debug('[activity-log] Could not note action:', error);
    }
  }

  /** The account to credit an event to, if someone asked for it recently enough. */
  private actorFor(instanceId: string | null | undefined): string | null {
    const entry = this.recentActors[instanceId || '*'] || this.recentActors['*'];
    if (!entry) return null;
    return Date.now() - entry.at <= ACTOR_TTL_MS ? entry.username : null;
  }

  private instanceIdFrom(payload: any): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const id = payload.instanceId || payload.id || payload.serverId;
    return typeof id === 'string' && id ? id : null;
  }

  /**
   * Inspect an outgoing broadcast and record it if it is one of the events the feed shows.
   * Called for every broadcast, so it stays cheap and ignores the noisy channels (logs,
   * memory and cpu samples) outright.
   */
  recordFromBroadcast(channel: string, data: any): void {
    try {
      switch (channel) {
        case 'server-instances':
          if (Array.isArray(data)) this.noteInstanceNames(data);
          return;

        case 'server-instance-state': {
          const instanceId = data?.instanceId;
          const state = String(data?.state || '').toLowerCase();
          if (!instanceId || !state) return;
          const previous = this.lastState[instanceId];
          this.lastState[instanceId] = state;
          if (previous === state) return;
          const name = this.nameOf(instanceId);
          // A crash is nobody's doing, so it is never credited to whoever last acted.
          const actor = this.actorFor(instanceId);
          if (state === 'running') this.record('start', `${name} started`, instanceId, actor);
          else if (state === 'stopped' && previous && previous !== 'stopped') this.record('stop', `${name} stopped`, instanceId, actor);
          else if (state === 'crashed') this.record('crash', `${name} crashed`, instanceId, null);
          return;
        }

        case 'server-instance-players': {
          const instanceId = data?.instanceId;
          const players = typeof data?.players === 'number' ? data.players
            : (typeof data?.count === 'number' ? data.count : null);
          if (!instanceId || players === null) return;
          const previous = this.lastPlayers[instanceId];
          this.lastPlayers[instanceId] = players;
          if (typeof previous !== 'number' || previous === players) return;
          const delta = players - previous;
          const count = Math.abs(delta);
          const noun = count === 1 ? 'Player' : `${count} players`;
          this.record(delta > 0 ? 'join' : 'leave', `${noun} ${delta > 0 ? 'joined' : 'left'} (${this.nameOf(instanceId)})`, instanceId);
          return;
        }

        case 'backup-created': {
          if (!data?.instanceId) return;
          const scheduled = data.type === 'scheduled';
          const label = scheduled ? 'Scheduled backup' : 'Backup';
          // A scheduled backup has no actor by definition.
          this.record('backup', `${label} completed (${this.nameOf(data.instanceId)})`, data.instanceId,
            scheduled ? null : this.actorFor(data.instanceId));
          return;
        }

        // 'ark-update-available' is deliberately not recorded: the poll repeats it on every
        // check while an update is outstanding, which filled the feed with the same line.
        // A waiting update is shown by the mark in the sidebar and the ARK Installation page.

        case 'notification': {
          if (data?.type === 'error' && data?.message) this.record('error', String(data.message));
          return;
        }

        default:
          return;
      }
    } catch (error) {
      // The feed is a convenience; never let it break a broadcast.
      console.debug('[activity-log] Could not record broadcast:', error);
    }
  }

  /** Write an entry. `username` attributes an action to whoever performed it. */
  record(kind: ActivityKind, message: string, instanceId?: string | null, username?: string | null): void {
    try {
      userDatabaseService.recordActivity({
        kind,
        message,
        instanceId: instanceId ?? null,
        username: username ?? null,
        maxEntries: MAX_ENTRIES
      });
    } catch (error) {
      console.debug('[activity-log] Could not write entry:', error);
    }
  }

  list(limit = 100): ActivityEntry[] {
    try {
      return userDatabaseService.listActivity(limit);
    } catch (error) {
      console.debug('[activity-log] Could not read entries:', error);
      return [];
    }
  }

  clear(): void {
    try {
      userDatabaseService.clearActivity();
    } catch (error) {
      console.debug('[activity-log] Could not clear entries:', error);
    }
  }
}

export const activityLogService = new ActivityLogService();
