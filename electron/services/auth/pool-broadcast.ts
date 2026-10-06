import { ROLE_IDS } from '../../types/auth.types';
import type { BroadcastAudience } from '../../types/messaging.types';
import { instanceVisibleTo, PoolInstance } from './pool-access';
import { PoolDirectory, poolDirectory, PoolSnapshot } from './pool-directory';

/**
 * Which web clients a broadcast is for.
 *
 * Decided here in main, which owns the user database; the web server child only matches socket
 * user ids against the audience. Admins, auth-off sockets and the legacy single login always
 * receive a scoped broadcast. Channels not listed here go to everyone.
 */

export interface ScopedBroadcast {
  data: unknown;
  audience?: BroadcastAudience;
}

/** Channels whose payload names one server in `instanceId`. */
const INSTANCE_ID_CHANNELS = new Set([
  'server-instance-state',
  'server-instance-log',
  'server-instance-players',
  'server-instance-memory',
  'server-instance-cpu',
  'rcon-status',
  'clear-server-instance-logs',
  'backup-created',
  'notification',
  'server-move-progress'
]);

type Directory = Pick<PoolDirectory, 'snapshot'>;

export function scopeBroadcast(channel: string, data: unknown, directory: Directory = poolDirectory): ScopedBroadcast[] {
  if (channel === 'server-instances' && Array.isArray(data)) {
    return withSnapshot(directory, data, snapshot => scopeList(data, snapshot));
  }
  if (channel === 'server-instance-updated' && isRecord(data) && typeof data.id === 'string') {
    return withSnapshot(directory, data, snapshot => [{ data, audience: audienceFor(snapshot, data) }]);
  }
  if (INSTANCE_ID_CHANNELS.has(channel) && isRecord(data) && typeof data.instanceId === 'string') {
    const id = data.instanceId;
    return withSnapshot(directory, data, snapshot => [{
      data,
      audience: audienceFor(snapshot, snapshot.instances.find(instance => instance.id === id) ?? null)
    }]);
  }
  return [{ data }];
}

function withSnapshot(directory: Directory, data: unknown, scope: (snapshot: PoolSnapshot) => ScopedBroadcast[]): ScopedBroadcast[] {
  const snapshot = directory.snapshot();
  return snapshot.scoped ? scope(snapshot) : [{ data }];
}

/** Admins and everyone who may see `instance`; admins only when the server is unknown. */
function audienceFor(snapshot: PoolSnapshot, instance: PoolInstance | null): BroadcastAudience {
  const userIds = snapshot.users
    .filter(user => user.roleId === ROLE_IDS.ADMIN || (instance !== null && instanceVisibleTo(user, instance)))
    .map(user => user.id);
  return { userIds, owners: true };
}

/**
 * The full list for admins and owners, then one message per distinct view the other accounts
 * have. An account that may see nothing still gets an empty list, so its dashboard empties.
 */
function scopeList(list: unknown[], snapshot: PoolSnapshot): ScopedBroadcast[] {
  const admins = snapshot.users.filter(user => user.roleId === ROLE_IDS.ADMIN).map(user => user.id);
  const messages: ScopedBroadcast[] = [{ data: list, audience: { userIds: admins, owners: true } }];
  const views = new Map<string, { userIds: string[]; data: unknown[] }>();
  for (const user of snapshot.users) {
    if (user.roleId === ROLE_IDS.ADMIN) continue;
    const visible = list.filter(item => isRecord(item) && instanceVisibleTo(user, item));
    const key = visible.map(item => (item as { id?: unknown }).id).join('\n');
    const view = views.get(key);
    if (view) view.userIds.push(user.id);
    else views.set(key, { userIds: [user.id], data: visible });
  }
  for (const view of views.values()) {
    messages.push({ data: view.data, audience: { userIds: view.userIds, owners: false } });
  }
  return messages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
