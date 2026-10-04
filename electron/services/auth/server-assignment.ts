import { isAssignableRole, ROLE_IDS } from '../../types/auth.types';
import { getInstance } from '../../utils/ark/instance.utils';
import { instanceVisibleTo } from './pool-access';
import { SenderIdentity } from './permission-gate';

/** Admin, the local desktop, and Operator may attach a server to a server manager. */
export function canAssignServerManager(identity: SenderIdentity): boolean {
  if (identity.isAdmin) return true;
  return identity.user?.roleId === ROLE_IDS.OPERATOR;
}

export function isServerManager(identity: SenderIdentity): boolean {
  return identity.user?.roleId === ROLE_IDS.SERVER_MANAGER;
}

/** Server managers and attendants only see the servers assigned to them. */
export function isAssignmentScoped(identity: SenderIdentity): boolean {
  return isAssignableRole(identity.user?.roleId);
}

/** Everyone except an admin is limited to their own group or their assigned servers. */
export function isServerScoped(identity: SenderIdentity): boolean {
  return !identity.isAdmin && !!identity.user;
}

/**
 * Instance ids carried on a message. Several handlers use different key names for the same thing.
 * An empty result means the message is not about one server.
 */
export function instanceIdsInPayload(payload: any): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const ids: string[] = [];
  for (const key of ['instanceId', 'id', 'serverId', 'targetId']) {
    if (typeof payload[key] === 'string' && payload[key]) ids.push(payload[key]);
  }
  if (payload.instance && typeof payload.instance.id === 'string' && payload.instance.id) {
    ids.push(payload.instance.id);
  }
  if (Array.isArray(payload.orderedIds)) {
    for (const id of payload.orderedIds) {
      if (typeof id === 'string' && id) ids.push(id);
    }
  }
  return ids;
}

/** True when this account may see this server. Missing instances are refused. */
export function serverMayAccess(user: { id?: string; roleId?: string; ownerUserId?: string | null } | null | undefined, instanceId: string): boolean {
  try {
    const instance = getInstance(instanceId);
    if (!instance || !user?.id) return false;
    if (user.roleId === ROLE_IDS.ADMIN) return true;
    return instanceVisibleTo(user, instance);
  } catch {
    return false;
  }
}

export function filterInstancesForUser(user: { id?: string; roleId?: string; ownerUserId?: string | null } | null | undefined, instances: any[]): any[] {
  const list = instances || [];
  if (!user?.id || user.roleId === ROLE_IDS.ADMIN) return list;
  return list.filter(instance => instance && instanceVisibleTo(user, instance));
}

/**
 * Per-connection view of a broadcast. `undefined` means do not send it to this user.
 * An admin receives the original payload. Everyone else only receives their own group.
 */
export function filterBroadcastForUser(channel: string, data: any, user: { id?: string; roleId?: string; ownerUserId?: string | null } | null | undefined): any {
  if (!user?.id || user.roleId === ROLE_IDS.ADMIN) return data;
  if (channel === 'server-instances' && Array.isArray(data)) {
    return filterInstancesForUser(user, data);
  }
  if (channel === 'server-instance-updated' && data && typeof data === 'object') {
    return instanceVisibleTo(user, data) ? data : undefined;
  }
  if (data && typeof data === 'object' && typeof data.instanceId === 'string') {
    return serverMayAccess(user, data.instanceId) ? data : undefined;
  }
  return data;
}
