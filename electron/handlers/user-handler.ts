import { messagingService } from '../services/messaging.service';
import { userDatabaseService } from '../services/auth/user-database.service';
import { identifySender, SenderIdentity } from '../services/auth/permission-gate';
import { filterInstancesForUser, holdsAccountPermission, isPoolOwnerIdentity, isPoolRole } from '../services/auth/pool-access';
import { poolDirectory } from '../services/auth/pool-directory';
import { getAllInstances } from '../utils/ark/instance.utils';
import {
  ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, BUILT_IN_ROLES, Permission, PoolLabel, ROLE_IDS, User,
  isAssignableRole, PERMISSIONS
} from '../types/auth.types';
import { onRequest } from './handler.utils';

/**
 * Accounts: users, roles and the current session's identity.
 *
 * MessagingService checks each channel's permission before these run (see channel-permissions).
 * What depends on who is asking is checked here. Three kinds of caller reach the account
 * channels: an admin (or the desktop), a non-admin holding users.manage, and a pool owner who
 * holds one or more accounts.* permissions and only ever sees their own pool.
 */

type CallerKind = 'admin' | 'manager' | 'pool-owner' | 'none';

function callerKind(identity: SenderIdentity): CallerKind {
  if (identity.isAdmin) return 'admin';
  if (identity.permissions.includes(PERMISSIONS.USERS_MANAGE)) return 'manager';
  if (isPoolOwnerIdentity(identity.permissions)) return 'pool-owner';
  return 'none';
}

onRequest('get-current-user', (_payload, { sender }) => {
  const identity = identifySender(sender);
  return {
    success: true,
    // The desktop window has no account; it is simply the owner of the machine.
    user: identity.user,
    isLocalDesktop: identity.isLocalDesktop,
    isAdmin: identity.isAdmin,
    permissions: identity.isAdmin ? [...ALL_PERMISSIONS] : identity.permissions,
    accountsInUse: userDatabaseService.hasAnyUser()
  };
});

onRequest('get-users', (_payload, { sender }) => ({
  success: true,
  users: visibleUsers(identifySender(sender)),
  roles: userDatabaseService.listRoles()
}), { onError: message => ({ success: false, error: message, users: [], roles: [] }) });

onRequest('create-user', async (payload, { sender, afterReply }) => {
  const { username, password, displayName, roleId, active } = payload;
  const identity = identifySender(sender);
  const kind = callerKind(identity);

  if (kind === 'pool-owner') {
    if (!isPoolRole(roleId)) return { success: false, error: 'An operator can only create a server manager, attendant or viewer.' };
    if (!holdsAccountPermission(identity.permissions, roleId, 'create')) {
      return { success: false, error: 'Your role cannot create that kind of account.' };
    }
  } else {
    const refusal = roleAssignmentRefusal(identity, roleId);
    if (refusal) return { success: false, error: refusal };
  }
  // A pool owner's accounts always land in their own pool, whatever the payload says.
  const ownerUserId = kind === 'pool-owner' ? identity.user!.id : payload.ownerUserId;

  const result = await userDatabaseService.createUser({ username, password, displayName, roleId, active, ownerUserId });
  if (!result.success) return { success: false, error: result.error };
  afterReply(() => broadcastUsersChanged());
  return { success: true, user: result.data };
});

onRequest('update-user', async (payload, { sender, afterReply }) => {
  const { id } = payload;
  const identity = identifySender(sender);
  const kind = callerKind(identity);
  // Changing your own role or disabling yourself is a foot-gun; block it outright.
  if (identity.user && identity.user.id === id) {
    if ((payload.roleId && payload.roleId !== identity.user.roleId) || payload.active === false) {
      return { success: false, error: 'You cannot change your own role or disable your own account.' };
    }
  }
  const existing = typeof id === 'string' ? userDatabaseService.getAuthenticatedUser(id) : null;

  if (kind === 'pool-owner') {
    const refusal = poolEditRefusal(identity, existing, payload.roleId);
    if (refusal) return { success: false, error: refusal };
  } else {
    const refusal = accountRefusal(identity, id) ?? roleAssignmentRefusal(identity, payload.roleId);
    if (refusal) return { success: false, error: refusal };
  }

  // A pool owner never moves accounts; an admin or users.manage holder may, when nothing is
  // still assigned to the account.
  const ownerUserId = kind === 'pool-owner' ? undefined : payload.ownerUserId;
  if (existing) {
    // An operator who stops being an active operator would leave a pool nobody owns.
    const leavingOperator = existing.roleId === ROLE_IDS.OPERATOR
      && (payload.active === false || (payload.roleId !== undefined && payload.roleId !== ROLE_IDS.OPERATOR));
    if (leavingOperator) {
      const refusal = await poolStillOwnedRefusal(existing.id);
      if (refusal) return { success: false, error: refusal };
    }
    const assigned = isAssignableRole(existing.roleId) && (await getAllInstances()).some(instance => instance.managerUserId === existing.id);
    if (assigned && payload.roleId && payload.roleId !== existing.roleId && !isAssignableRole(payload.roleId)) {
      return { success: false, error: 'Reassign their servers before changing this role.' };
    }
    if (assigned && ownerUserId !== undefined && (ownerUserId || null) !== (existing.ownerUserId || null)) {
      return { success: false, error: 'Reassign their servers before moving them to another pool.' };
    }
  }

  const result = await userDatabaseService.updateUser({
    id,
    username: payload.username,
    displayName: payload.displayName,
    roleId: payload.roleId,
    active: payload.active,
    password: payload.password,
    ...(ownerUserId !== undefined ? { ownerUserId } : {})
  });
  if (!result.success) return { success: false, error: result.error };
  afterReply(() => broadcastUsersChanged(id));
  return { success: true, user: result.data };
});

onRequest('delete-user', async (payload, { sender, afterReply }) => {
  const { id } = payload;
  const identity = identifySender(sender);
  if (identity.user && identity.user.id === id) {
    return { success: false, error: 'You cannot delete your own account.' };
  }
  const existing = typeof id === 'string' ? userDatabaseService.getAuthenticatedUser(id) : null;

  if (callerKind(identity) === 'pool-owner') {
    if (!existing || existing.ownerUserId !== identity.user?.id) return { success: false, error: 'That account is not in your pool.' };
    if (!holdsAccountPermission(identity.permissions, existing.roleId, 'delete')) {
      return { success: false, error: 'Your role cannot delete that account.' };
    }
  } else {
    const refusal = accountRefusal(identity, id);
    if (refusal) return { success: false, error: refusal };
  }

  if (existing) {
    // Nothing may be left pointing at an account that is gone.
    const refusal = await poolStillOwnedRefusal(existing.id)
      ?? ((await getAllInstances()).some(instance => instance.managerUserId === existing.id)
        ? 'Reassign their servers before deleting this account.'
        : null);
    if (refusal) return { success: false, error: refusal };
  }

  const result = userDatabaseService.deleteUser(id);
  if (!result.success) return { success: false, error: result.error };
  afterReply(() => broadcastUsersChanged(id));
  return { success: true, id };
});

/**
 * Names for the ownership line on a server and the ownership dropdowns. An admin gets every
 * operator and assignee, an operator their own pool, and a pool member the operator and
 * assignee of the servers they can see.
 */
onRequest('list-pool-labels', async (_payload, { sender }) => {
  const identity = identifySender(sender);
  const users = userDatabaseService.listUsers().filter(user => user.active);
  const operators = users.filter(user => user.roleId === ROLE_IDS.OPERATOR);
  const assignees = users.filter(user => isAssignableRole(user.roleId));

  if (identity.isAdmin) {
    return { success: true, operators: operators.map(toLabel), assignees: assignees.map(toLabel) };
  }
  const me = identity.user!;
  if (me.roleId === ROLE_IDS.OPERATOR) {
    return {
      success: true,
      operators: operators.filter(user => user.id === me.id).map(toLabel),
      assignees: assignees.filter(user => user.ownerUserId === me.id).map(toLabel)
    };
  }
  const visible = filterInstancesForUser(me, await getAllInstances());
  const operatorIds = new Set(visible.map(instance => instance.operatorUserId).filter(Boolean));
  const assigneeIds = new Set(visible.map(instance => instance.managerUserId).filter(Boolean));
  if (isAssignableRole(me.roleId)) assigneeIds.add(me.id);
  return {
    success: true,
    operators: operators.filter(user => operatorIds.has(user.id)).map(toLabel),
    assignees: assignees.filter(user => assigneeIds.has(user.id)).map(toLabel)
  };
}, { onError: message => ({ success: false, error: message, operators: [], assignees: [] }) });

onRequest('get-roles', () => ({
  success: true,
  roles: userDatabaseService.listRoles(),
  permissions: ALL_PERMISSIONS.map(permission => ({ id: permission, ...PERMISSION_DESCRIPTIONS[permission] })),
  builtInRoleIds: BUILT_IN_ROLES.map(role => role.id)
}), { onError: message => ({ success: false, error: message, roles: [], permissions: [] }) });

onRequest('create-role', (payload, { sender, afterReply }) => {
  const { name, description, permissions } = payload;
  const refusal = grantRefusal(identifySender(sender), permissions, []);
  if (refusal) return { success: false, error: refusal };

  const result = userDatabaseService.createRole({ name, description, permissions });
  if (!result.success) return { success: false, error: result.error };
  afterReply(() => broadcastUsersChanged());
  return { success: true, role: result.data };
});

onRequest('update-role', (payload, { sender, afterReply }) => {
  const { id, name, description, permissions } = payload;
  const existing = typeof id === 'string' ? userDatabaseService.getRole(id) : null;
  const refusal = grantRefusal(identifySender(sender), permissions, existing?.permissions ?? []);
  if (refusal) return { success: false, error: refusal };

  const result = userDatabaseService.updateRole({ id, name, description, permissions });
  if (!result.success) return { success: false, error: result.error };
  // Everyone holding this role now has different rights, so their sessions must be refreshed.
  afterReply(() => broadcastUsersChanged(undefined, id));
  return { success: true, role: result.data };
});

onRequest('delete-role', (payload, { sender, afterReply }) => {
  const { id } = payload;
  const refusal = roleDeletionRefusal(identifySender(sender), id);
  if (refusal) return { success: false, error: refusal };

  const result = userDatabaseService.deleteRole(id);
  if (!result.success) return { success: false, error: result.error };
  afterReply(() => broadcastUsersChanged());
  return { success: true, id };
});

onRequest('change-own-password', async (payload, { sender }) => {
  const { currentPassword, newPassword } = payload;
  const identity = identifySender(sender);
  if (!identity.user) {
    return { success: false, error: 'The desktop app does not sign in, so there is no password to change here.' };
  }
  const result = await userDatabaseService.changeOwnPassword(identity.user.id, currentPassword, newPassword);
  return result.success ? { success: true } : { success: false, error: result.error };
});

/** Why an operator cannot leave their pool behind: accounts or servers still in it. */
async function poolStillOwnedRefusal(operatorId: string): Promise<string | null> {
  if (userDatabaseService.listUsers().some(user => user.ownerUserId === operatorId)) {
    return 'Move or delete the accounts in this pool first.';
  }
  if ((await getAllInstances()).some(instance => instance.operatorUserId === operatorId)) {
    return 'Move or delete this operator\'s servers first.';
  }
  return null;
}

/** A pool owner sees their pool; an admin or users.manage holder sees everyone. */
function visibleUsers(identity: SenderIdentity): User[] {
  const users = userDatabaseService.listUsers();
  if (callerKind(identity) !== 'pool-owner') return users;
  return users.filter(user => user.ownerUserId === identity.user?.id);
}

/** Why a pool owner may not edit `existing`, or give it `nextRoleId`; null when they may. */
function poolEditRefusal(identity: SenderIdentity, existing: User | null, nextRoleId: unknown): string | null {
  if (!existing || existing.ownerUserId !== identity.user?.id) return 'That account is not in your pool.';
  if (!holdsAccountPermission(identity.permissions, existing.roleId, 'create')) return 'Your role cannot edit that account.';
  if (nextRoleId !== undefined && nextRoleId !== existing.roleId) {
    if (!isPoolRole(nextRoleId as string) || !holdsAccountPermission(identity.permissions, nextRoleId as string, 'create')) {
      return 'Your role cannot give that account this role.';
    }
  }
  return null;
}

function toLabel(user: User): PoolLabel {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roleName: userDatabaseService.getRole(user.roleId)?.name || '',
    ownerUserId: user.ownerUserId
  };
}

// A non-admin holding users.manage may only hand out what they hold themselves. Otherwise they
// could create, promote or take over an account with more rights and sign in as it.

function holdsAll(identity: SenderIdentity, permissions: readonly Permission[]): boolean {
  return permissions.every(permission => identity.permissions.includes(permission));
}

function roleAssignmentRefusal(identity: SenderIdentity, roleId: unknown): string | null {
  if (identity.isAdmin || roleId === undefined) return null;
  if (roleId === ROLE_IDS.ADMIN) return 'Only an admin can give out the Admin role.';
  // An unknown role is left for the database to refuse with its own message.
  const role = typeof roleId === 'string' ? userDatabaseService.getRole(roleId) : null;
  if (role && !holdsAll(identity, role.permissions)) {
    return 'You cannot give out a role with permissions you do not have.';
  }
  return null;
}

function accountRefusal(identity: SenderIdentity, userId: unknown): string | null {
  if (identity.isAdmin) return null;
  const target = typeof userId === 'string' ? userDatabaseService.getAuthenticatedUser(userId) : null;
  if (!target) return null;
  if (target.roleId === ROLE_IDS.ADMIN) return 'Only an admin can manage an admin account.';
  if (!holdsAll(identity, target.permissions)) {
    return 'You cannot manage an account that has permissions you do not have.';
  }
  return null;
}

function roleDeletionRefusal(identity: SenderIdentity, roleId: unknown): string | null {
  if (identity.isAdmin) return null;
  const role = typeof roleId === 'string' ? userDatabaseService.getRole(roleId) : null;
  if (role && !holdsAll(identity, role.permissions)) {
    return 'You cannot delete a role with permissions you do not have.';
  }
  return null;
}

function grantRefusal(identity: SenderIdentity, permissions: unknown, existing: readonly Permission[]): string | null {
  if (identity.isAdmin || !Array.isArray(permissions)) return null;
  const added = permissions.filter((permission: Permission) => !existing.includes(permission));
  return holdsAll(identity, added) ? null : 'You cannot grant permissions you do not have.';
}

/**
 * Tell every client the account list moved, and ask the web server to drop sessions whose
 * rights just changed so a demoted user does not keep their old permissions until logout.
 */
function broadcastUsersChanged(userId?: string, roleId?: string) {
  // Pools may have moved, so the broadcast path must not keep answering from the old picture.
  poolDirectory.invalidate();
  messagingService.sendToAll('users-changed', { userId, roleId });
  messagingService.invalidateWebSessions({ userId, roleId });
}
