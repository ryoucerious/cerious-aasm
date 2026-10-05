import { PERMISSIONS, Permission, ROLE_IDS } from '../../types/auth.types';

/**
 * Who may see which server.
 *
 * Pure rules with no database access. Admins, the desktop window and auth-off web sockets are
 * decided by the callers and never reach these functions as a user.
 */

/** The fields of an account these rules read. */
export interface PoolUser {
  id: string;
  roleId: string;
  ownerUserId?: string | null;
}

/** The fields of a server config these rules read. */
export interface PoolInstance {
  operatorUserId?: string | null;
  managerUserId?: string | null;
}

/** Server managers, attendants and viewers live in a pool. Admins and operators do not. */
export function isPoolRole(roleId: string | null | undefined): boolean {
  return roleId === ROLE_IDS.SERVER_MANAGER || roleId === ROLE_IDS.ATTENDANT || roleId === ROLE_IDS.VIEWER;
}

/**
 * The permission for creating (also editing) or deleting one kind of pool account. Separate
 * per kind and per action so an operator can be allowed to add a server manager without being
 * allowed to delete one. Mirrored by accountPermissionFor in src/app/core/models/auth.model.ts.
 */
export function accountPermission(roleId: string | null | undefined, action: 'create' | 'delete'): Permission | null {
  switch (roleId) {
    case ROLE_IDS.SERVER_MANAGER:
      return action === 'create' ? PERMISSIONS.ACCOUNTS_MANAGERS_CREATE : PERMISSIONS.ACCOUNTS_MANAGERS_DELETE;
    case ROLE_IDS.ATTENDANT:
      return action === 'create' ? PERMISSIONS.ACCOUNTS_ATTENDANTS_CREATE : PERMISSIONS.ACCOUNTS_ATTENDANTS_DELETE;
    case ROLE_IDS.VIEWER:
      return action === 'create' ? PERMISSIONS.ACCOUNTS_VIEWERS_CREATE : PERMISSIONS.ACCOUNTS_VIEWERS_DELETE;
    default:
      return null;
  }
}

export function holdsAccountPermission(
  permissions: readonly Permission[],
  roleId: string | null | undefined,
  action: 'create' | 'delete'
): boolean {
  const required = accountPermission(roleId, action);
  return required !== null && permissions.includes(required);
}

/** True when the permissions include any of the six account permissions: the holder owns a pool. */
export function isPoolOwnerIdentity(permissions: readonly Permission[]): boolean {
  return permissions.some(permission => permission.startsWith('accounts.'));
}

/**
 * Whether `user` may see `instance`.
 *
 * An operator sees their pool. A viewer sees their owner's pool. A server manager or attendant
 * sees the servers assigned to them. A role this app does not know stays in the admin pool,
 * so it never sees an operator's servers. An admin is not passed here.
 */
export function instanceVisibleTo(user: PoolUser | null | undefined, instance: PoolInstance | null | undefined): boolean {
  if (!user?.id || !instance) return false;
  const pool = instance.operatorUserId || null;
  switch (user.roleId) {
    case ROLE_IDS.OPERATOR:
      return pool === user.id;
    case ROLE_IDS.VIEWER:
      return pool === (user.ownerUserId || null);
    case ROLE_IDS.SERVER_MANAGER:
    case ROLE_IDS.ATTENDANT:
      // Assigned, and the server is in their pool: an assignment that outlived a pool move must
      // not keep showing them a server their operator no longer has.
      return !!instance.managerUserId && instance.managerUserId === user.id && pool === (user.ownerUserId || null);
    default:
      return pool === null;
  }
}

/** The instances `user` may see; everything for an admin, nothing for nobody. */
export function filterInstancesForUser<T extends PoolInstance>(user: PoolUser | null | undefined, instances: T[]): T[] {
  if (!user?.id) return [];
  if (user.roleId === ROLE_IDS.ADMIN) return instances;
  return instances.filter(instance => instanceVisibleTo(user, instance));
}

/** The ids `user` may see, or null when they may see everything. */
export function visibleInstanceIds(
  user: PoolUser | null | undefined,
  instances: Array<{ id: string } & PoolInstance>
): Set<string> | null {
  if (user?.roleId === ROLE_IDS.ADMIN) return null;
  return new Set(filterInstancesForUser(user, instances).map(instance => instance.id));
}
