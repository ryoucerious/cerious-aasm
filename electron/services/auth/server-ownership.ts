import type { InstanceConfig } from '../../types/server-instance.types';
import { isAssignableRole, ROLE_IDS, User } from '../../types/auth.types';
import type { SenderIdentity } from './permission-gate';

/**
 * Which pool a server is in and who it is assigned to.
 *
 * Pure rules: the account lookup is passed in, so the handler decides where accounts come from
 * and the tests hand in a map.
 */

export type UserLookup = (id: string) => User | null;

type Ownership = Pick<InstanceConfig, 'operatorUserId' | 'managerUserId'>;

/** Admin, the desktop, or the operator whose pool the server is in may attach an assignee. */
export function canAssignFor(identity: SenderIdentity, existing: Ownership): boolean {
  if (identity.isAdmin) return true;
  return identity.user?.roleId === ROLE_IDS.OPERATOR && (existing.operatorUserId || null) === identity.user.id;
}

/** Why `operatorUserId` cannot own a server; null when it names an active operator. */
export function operatorRefusal(operatorUserId: string, lookup: UserLookup): string | null {
  const operator = lookup(operatorUserId);
  if (!operator || !operator.active || operator.roleId !== ROLE_IDS.OPERATOR) {
    return 'Choose an active operator for this server.';
  }
  return null;
}

/** Why `managerUserId` cannot be assigned a server in `operatorUserId`'s pool; null when they can. */
export function assigneeRefusal(
  managerUserId: string | null | undefined,
  operatorUserId: string | null | undefined,
  lookup: UserLookup
): string | null {
  if (!managerUserId) return null;
  const assignee = lookup(managerUserId);
  if (!assignee || !assignee.active || !isAssignableRole(assignee.roleId)) {
    return 'Choose an active server manager or attendant.';
  }
  if ((assignee.ownerUserId || null) !== (operatorUserId || null)) {
    return 'That person is not in this server\'s pool.';
  }
  return null;
}

/**
 * Settle `instance.operatorUserId` and `instance.managerUserId` for a save, in place.
 *
 * A new server goes in the operator's own pool, where an admin says, or, for a server manager
 * who may create, is assigned to them in their owner's pool. On an edit the stored values are
 * kept unless the caller may change them: the pool by an admin, the assignee by an admin or the
 * pool's operator. A field the payload leaves out keeps its stored value, so a UI that sends a
 * partial object never drops ownership. The assignee is checked only when it changes, so a stale
 * id left by a deleted account does not block an unrelated edit.
 *
 * Returns the refusal sentence, or null when the save may go ahead.
 */
export function applyServerOwnership(
  instance: Partial<InstanceConfig>,
  existing: InstanceConfig | null,
  identity: SenderIdentity,
  lookup: UserLookup
): string | null {
  const user = identity.user;

  if (!existing) {
    if (identity.isAdmin) {
      if (instance.operatorUserId) {
        const refusal = operatorRefusal(instance.operatorUserId, lookup);
        if (refusal) return refusal;
      }
    } else if (user?.roleId === ROLE_IDS.OPERATOR) {
      instance.operatorUserId = user.id;
    } else if (user && isAssignableRole(user.roleId)) {
      instance.operatorUserId = user.ownerUserId || null;
      instance.managerUserId = user.id;
    } else if (user) {
      instance.operatorUserId = user.ownerUserId || null;
    }
  } else {
    if (identity.isAdmin) {
      if (instance.operatorUserId === undefined) {
        keepStored(instance, existing, 'operatorUserId');
      } else if (instance.operatorUserId) {
        const refusal = operatorRefusal(instance.operatorUserId, lookup);
        if (refusal) return refusal;
      }
    } else {
      if (user?.roleId === ROLE_IDS.OPERATOR && (existing.operatorUserId || null) !== user.id) {
        return 'That server is not in your pool.';
      }
      keepStored(instance, existing, 'operatorUserId');
    }
    if (instance.managerUserId === undefined || !canAssignFor(identity, existing)) {
      keepStored(instance, existing, 'managerUserId');
    }
  }

  // The assignee must be in the server's pool. Checked when either side moves: a new assignee
  // is refused, and an assignee left behind by a pool move is dropped, as set-server-operator does.
  const pool = settled(instance, existing, 'operatorUserId');
  const assignee = settled(instance, existing, 'managerUserId');
  const poolChanged = !!existing && pool !== (existing.operatorUserId || null);
  const assigneeChanged = assignee !== (existing?.managerUserId || null);
  if (assignee && (assigneeChanged || poolChanged)) {
    const refusal = assigneeRefusal(assignee, pool, lookup);
    if (refusal && assigneeChanged) return refusal;
    if (refusal) instance.managerUserId = null;
  }
  return null;
}

/** The value a field will have after the save: the payload's when given, else the stored one. */
function settled(instance: Partial<InstanceConfig>, existing: InstanceConfig | null, field: keyof Ownership): string | null {
  const value = instance[field] !== undefined ? instance[field] : existing?.[field];
  return value || null;
}

/** Copy one ownership field from the stored config, or leave it absent when it was never stored. */
function keepStored(instance: Partial<InstanceConfig>, existing: InstanceConfig, field: keyof Ownership): void {
  if (existing[field] === undefined) delete instance[field];
  else instance[field] = existing[field];
}
