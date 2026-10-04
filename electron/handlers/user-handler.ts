import { messagingService } from '../services/messaging.service';
import { userDatabaseService } from '../services/auth/user-database.service';
import { identifySender, SenderIdentity } from '../services/auth/permission-gate';
import { canAssignServerManager, filterInstancesForUser } from '../services/auth/server-assignment';
import { holdsAccountPermission, isPoolRole } from '../services/auth/pool-access';
import { getAllInstances } from '../utils/ark/instance.utils';
import { ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, BUILT_IN_ROLES, effectivePermissions, isAssignableRole, ROLE_IDS, User } from '../types/auth.types';

/**
 * Accounts: users, roles and the current session's identity.
 *
 * Every channel here is gated by MessagingService before it runs (see channel-permissions),
 * so these handlers do not repeat the permission check — with one exception: a user editing
 * or deleting themselves is restricted here, because that depends on who is asking rather
 * than on the role.
 */

function reply(channel: string, payload: any, sender: any, requestId: string | undefined, data: any) {
  messagingService.sendToOriginator(channel, { ...data, requestId }, sender);
}

function accountActorError(identity: SenderIdentity): string | null {
  if (identity.isAdmin) return null;
  if (identity.user?.roleId === ROLE_IDS.OPERATOR) return null;
  return 'Only an admin or an operator can manage accounts.';
}

function visibleUsers(identity: SenderIdentity): User[] {
  const users = userDatabaseService.listUsers();
  if (identity.isAdmin) return users;
  if (identity.user?.roleId !== ROLE_IDS.OPERATOR) return [];
  return users.filter(user => user.ownerUserId === identity.user?.id);
}

function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roleId: user.roleId,
    roleName: userDatabaseService.getRole(user.roleId)?.name || '',
    ownerUserId: user.ownerUserId
  };
}

/** Admin may place a pool account under an operator. An operator's accounts always stay under themselves. */
function ownerForCreate(identity: SenderIdentity, roleId: string, requested: string | null | undefined): { owner: string | null; error?: string } {
  if (!isPoolRole(roleId)) return { owner: null };
  if (!identity.isAdmin) return { owner: identity.user?.id || null };
  return { owner: requested || null };
}

/** The signed-in account, the permissions it holds, and whether accounts are in use at all. */
messagingService.on('get-current-user', (payload: any, sender: any) => {
  const { requestId } = payload || {};
  try {
    const identity = identifySender(sender);
    // The session snapshot does not carry the command-line lock, and it can change on
    // the next process start, so read it from the database for this response.
    const user = identity.user ? { ...identity.user } : null;
    if (user && user.id !== 'legacy-admin') {
      const fresh = userDatabaseService.getUser(user.id);
      if (fresh) {
        user.cliLocked = fresh.cliLocked;
        user.displayName = fresh.displayName || user.displayName;
        user.username = fresh.username;
        user.roleId = fresh.roleId;
        user.ownerUserId = fresh.ownerUserId;
        const role = userDatabaseService.getRole(fresh.roleId);
        if (role) {
          user.roleName = role.name;
          user.permissions = effectivePermissions(role);
        }
      }
    }
    reply('get-current-user', payload, sender, requestId, {
      success: true,
      // The desktop window has no account; it is simply the owner of the machine.
      user,
      isLocalDesktop: identity.isLocalDesktop,
      isAdmin: identity.isAdmin,
      permissions: identity.isAdmin ? [...ALL_PERMISSIONS] : (user?.permissions || identity.permissions),
      accountsInUse: userDatabaseService.hasAnyUser()
    });
  } catch (error) {
    reply('get-current-user', payload, sender, requestId, { success: false, error: (error as Error).message });
  }
});

messagingService.on('get-users', (payload: any, sender: any) => {
  const { requestId } = payload || {};
  try {
    const identity = identifySender(sender);
    reply('get-users', payload, sender, requestId, {
      success: true,
      users: visibleUsers(identity),
      roles: userDatabaseService.listRoles()
    });
  } catch (error) {
    reply('get-users', payload, sender, requestId, { success: false, error: (error as Error).message, users: [], roles: [] });
  }
});

messagingService.on('list-ownership-labels', async (payload: any, sender: any) => {
  const { requestId } = payload || {};
  try {
    const identity = identifySender(sender);
    const users = userDatabaseService.listUsers().filter(user => user.active);
    const visible = filterInstancesForUser(identity.user, await getAllInstances());
    const operatorIds = new Set<string>(visible.map((instance: any) => instance.operatorUserId).filter(Boolean));
    const assigneeIds = new Set<string>(visible.map((instance: any) => instance.managerUserId).filter(Boolean));
    if (identity.isAdmin) {
      for (const user of users) {
        if (user.roleId === ROLE_IDS.OPERATOR) operatorIds.add(user.id);
        if (isAssignableRole(user.roleId)) assigneeIds.add(user.id);
      }
    }
    if (identity.user?.roleId === ROLE_IDS.OPERATOR) operatorIds.add(identity.user.id);
    reply('list-ownership-labels', payload, sender, requestId, {
      success: true,
      operators: users.filter(user => user.roleId === ROLE_IDS.OPERATOR && operatorIds.has(user.id)).map(publicUser),
      assignees: users.filter(user => assigneeIds.has(user.id) && isAssignableRole(user.roleId)).map(publicUser)
    });
  } catch (error) {
    reply('list-ownership-labels', payload, sender, requestId, {
      success: false, error: (error as Error).message, operators: [], assignees: []
    });
  }
});

messagingService.on('list-server-managers', (payload: any, sender: any) => {
  const { requestId } = payload || {};
  try {
    const identity = identifySender(sender);
    if (!canAssignServerManager(identity)) {
      reply('list-server-managers', payload, sender, requestId, { success: false, error: 'Only an admin or operator can assign a server manager.', managers: [], operators: [] });
      return;
    }
    const users = userDatabaseService.listUsers().filter(user => user.active);
    const managers = users
      .filter(user => isAssignableRole(user.roleId))
      .filter(user => identity.isAdmin || user.ownerUserId === identity.user?.id)
      .map(publicUser);
    const operators = users
      .filter(user => user.roleId === ROLE_IDS.OPERATOR)
      .filter(user => identity.isAdmin || user.id === identity.user?.id)
      .map(publicUser);
    reply('list-server-managers', payload, sender, requestId, { success: true, managers, operators });
  } catch (error) {
    reply('list-server-managers', payload, sender, requestId, { success: false, error: (error as Error).message, managers: [], operators: [] });
  }
});

messagingService.on('create-server-manager', async (payload: any, sender: any) => {
  const { requestId, username, password, displayName } = payload || {};
  const roleId = payload?.roleId || ROLE_IDS.SERVER_MANAGER;
  try {
    const identity = identifySender(sender);
    const actorError = accountActorError(identity);
    if (actorError || !canAssignServerManager(identity)) {
      reply('create-server-manager', payload, sender, requestId, { success: false, error: actorError || 'Only an admin or operator can add a server manager.' });
      return;
    }
    if (!isAssignableRole(roleId)) {
      reply('create-server-manager', payload, sender, requestId, { success: false, error: 'Choose a server manager or an attendant.' });
      return;
    }
    if (!identity.isAdmin && !holdsAccountPermission(identity.permissions, roleId, 'create')) {
      reply('create-server-manager', payload, sender, requestId, { success: false, error: 'Your role cannot create that kind of account.' });
      return;
    }
    const owner = ownerForCreate(identity, roleId, payload?.ownerUserId);
    const result = await userDatabaseService.createUser({
      username,
      password,
      displayName: displayName || username,
      roleId,
      active: true,
      ownerUserId: owner.owner
    });
    reply('create-server-manager', payload, sender, requestId,
      result.success ? { success: true, user: result.data } : { success: false, error: result.error });
    if (result.success) broadcastUsersChanged();
  } catch (error) {
    reply('create-server-manager', payload, sender, requestId, { success: false, error: (error as Error).message });
  }
});

messagingService.on('create-user', async (payload: any, sender: any) => {
  const { requestId, username, password, displayName, roleId, active } = payload || {};
  try {
    const identity = identifySender(sender);
    const actorError = accountActorError(identity);
    if (actorError) {
      reply('create-user', payload, sender, requestId, { success: false, error: actorError });
      return;
    }
    if (!identity.isAdmin && !isPoolRole(roleId)) {
      reply('create-user', payload, sender, requestId, { success: false, error: 'An operator can only create a server manager, attendant, or viewer.' });
      return;
    }
    if (!identity.isAdmin && !holdsAccountPermission(identity.permissions, roleId, 'create')) {
      reply('create-user', payload, sender, requestId, { success: false, error: 'Your role cannot create that kind of account.' });
      return;
    }
    const owner = ownerForCreate(identity, roleId, payload?.ownerUserId);
    const result = await userDatabaseService.createUser({
      username, password, displayName, roleId, active, ownerUserId: owner.owner
    });
    reply('create-user', payload, sender, requestId,
      result.success ? { success: true, user: result.data } : { success: false, error: result.error });
    if (result.success) broadcastUsersChanged();
  } catch (error) {
    reply('create-user', payload, sender, requestId, { success: false, error: (error as Error).message });
  }
});

messagingService.on('update-user', async (payload: any, sender: any) => {
  const { requestId, id } = payload || {};
  try {
    const identity = identifySender(sender);
    const actorError = accountActorError(identity);
    if (actorError) {
      reply('update-user', payload, sender, requestId, { success: false, error: actorError });
      return;
    }
    const existing = userDatabaseService.getUser(id);
    if (!existing) {
      reply('update-user', payload, sender, requestId, { success: false, error: 'User not found.' });
      return;
    }
    if (!identity.isAdmin && existing.ownerUserId !== identity.user?.id) {
      reply('update-user', payload, sender, requestId, { success: false, error: 'That account is not in your group.' });
      return;
    }
    if (!identity.isAdmin && !holdsAccountPermission(identity.permissions, existing.roleId, 'create')) {
      reply('update-user', payload, sender, requestId, { success: false, error: 'Your role cannot edit that account.' });
      return;
    }
    if (!identity.isAdmin && payload.roleId && payload.roleId !== existing.roleId && !holdsAccountPermission(identity.permissions, payload.roleId, 'create')) {
      reply('update-user', payload, sender, requestId, { success: false, error: 'Your role cannot give that account this role.' });
      return;
    }
    if (identity.user && identity.user.id === id) {
      if ((payload.roleId && payload.roleId !== identity.user.roleId) || payload.active === false) {
        reply('update-user', payload, sender, requestId,
          { success: false, error: 'You cannot change your own role or disable your own account.' });
        return;
      }
    }
    const nextRole = payload.roleId || existing.roleId;
    if (payload.roleId && payload.roleId !== existing.roleId && !isAssignableRole(payload.roleId)) {
      const assigned = (await getAllInstances()).some((instance: any) => instance?.managerUserId === existing.id);
      if (assigned) {
        reply('update-user', payload, sender, requestId, { success: false, error: 'Reassign their servers before changing this role.' });
        return;
      }
    }
    let ownerUserId: string | null | undefined;
    if (identity.isAdmin && isPoolRole(nextRole)) {
      ownerUserId = payload.ownerUserId !== undefined ? (payload.ownerUserId || null) : existing.ownerUserId;
      if ((ownerUserId || null) !== (existing.ownerUserId || null)) {
        const assigned = (await getAllInstances()).some((instance: any) => instance?.managerUserId === existing.id);
        if (assigned) {
          reply('update-user', payload, sender, requestId, { success: false, error: 'Reassign their servers before moving them to another group.' });
          return;
        }
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
    reply('update-user', payload, sender, requestId,
      result.success ? { success: true, user: result.data } : { success: false, error: result.error });
    if (result.success) broadcastUsersChanged(id);
  } catch (error) {
    reply('update-user', payload, sender, requestId, { success: false, error: (error as Error).message });
  }
});

messagingService.on('delete-user', async (payload: any, sender: any) => {
  const { requestId, id } = payload || {};
  try {
    const identity = identifySender(sender);
    const actorError = accountActorError(identity);
    if (actorError) {
      reply('delete-user', payload, sender, requestId, { success: false, error: actorError });
      return;
    }
    const existing = userDatabaseService.getUser(id);
    if (!existing) {
      reply('delete-user', payload, sender, requestId, { success: false, error: 'User not found.' });
      return;
    }
    if (!identity.isAdmin && existing.ownerUserId !== identity.user?.id) {
      reply('delete-user', payload, sender, requestId, { success: false, error: 'That account is not in your group.' });
      return;
    }
    if (!identity.isAdmin && !holdsAccountPermission(identity.permissions, existing.roleId, 'delete')) {
      reply('delete-user', payload, sender, requestId, { success: false, error: 'Your role cannot delete that account.' });
      return;
    }
    if (identity.user && identity.user.id === id) {
      reply('delete-user', payload, sender, requestId, { success: false, error: 'You cannot delete your own account.' });
      return;
    }
    const ownsPeople = userDatabaseService.listUsers().some(user => user.ownerUserId === id);
    if (ownsPeople) {
      reply('delete-user', payload, sender, requestId, { success: false, error: 'Move or delete the accounts in this group first.' });
      return;
    }
    const instances = await getAllInstances();
    if (instances.some((instance: any) => instance?.managerUserId === id)) {
      reply('delete-user', payload, sender, requestId, { success: false, error: 'Reassign their servers before deleting this account.' });
      return;
    }
    if (instances.some((instance: any) => instance?.operatorUserId === id)) {
      reply('delete-user', payload, sender, requestId, { success: false, error: 'Move or delete this operator\'s servers first.' });
      return;
    }
    const result = userDatabaseService.deleteUser(id);
    reply('delete-user', payload, sender, requestId,
      result.success ? { success: true, id } : { success: false, error: result.error });
    if (result.success) broadcastUsersChanged(id);
  } catch (error) {
    reply('delete-user', payload, sender, requestId, { success: false, error: (error as Error).message });
  }
});

messagingService.on('get-roles', (payload: any, sender: any) => {
  const { requestId } = payload || {};
  try {
    reply('get-roles', payload, sender, requestId, {
      success: true,
      roles: userDatabaseService.listRoles(),
      permissions: ALL_PERMISSIONS.map(permission => ({ id: permission, ...PERMISSION_DESCRIPTIONS[permission] })),
      builtInRoleIds: BUILT_IN_ROLES.map(role => role.id)
    });
  } catch (error) {
    reply('get-roles', payload, sender, requestId, { success: false, error: (error as Error).message, roles: [], permissions: [] });
  }
});

messagingService.on('create-role', (payload: any, sender: any) => {
  const { requestId, name, description, permissions } = payload || {};
  try {
    if (!identifySender(sender).isAdmin) {
      reply('create-role', payload, sender, requestId, { success: false, error: 'Only an admin can change roles.' });
      return;
    }
    const result = userDatabaseService.createRole({ name, description, permissions });
    reply('create-role', payload, sender, requestId,
      result.success ? { success: true, role: result.data } : { success: false, error: result.error });
    if (result.success) broadcastUsersChanged();
  } catch (error) {
    reply('create-role', payload, sender, requestId, { success: false, error: (error as Error).message });
  }
});

messagingService.on('update-role', (payload: any, sender: any) => {
  const { requestId, id, name, description, permissions } = payload || {};
  try {
    if (!identifySender(sender).isAdmin) {
      reply('update-role', payload, sender, requestId, { success: false, error: 'Only an admin can change roles.' });
      return;
    }
    const result = userDatabaseService.updateRole({ id, name, description, permissions });
    reply('update-role', payload, sender, requestId,
      result.success ? { success: true, role: result.data } : { success: false, error: result.error });
    // Everyone holding this role now has different rights, so their sessions must be refreshed.
    if (result.success) broadcastUsersChanged(undefined, id);
  } catch (error) {
    reply('update-role', payload, sender, requestId, { success: false, error: (error as Error).message });
  }
});

messagingService.on('delete-role', (payload: any, sender: any) => {
  const { requestId, id } = payload || {};
  try {
    if (!identifySender(sender).isAdmin) {
      reply('delete-role', payload, sender, requestId, { success: false, error: 'Only an admin can change roles.' });
      return;
    }
    const result = userDatabaseService.deleteRole(id);
    reply('delete-role', payload, sender, requestId,
      result.success ? { success: true, id } : { success: false, error: result.error });
    if (result.success) broadcastUsersChanged();
  } catch (error) {
    reply('delete-role', payload, sender, requestId, { success: false, error: (error as Error).message });
  }
});

messagingService.on('change-own-password', async (payload: any, sender: any) => {
  const { requestId, currentPassword, newPassword } = payload || {};
  try {
    const identity = identifySender(sender);
    if (!identity.user) {
      reply('change-own-password', payload, sender, requestId,
        { success: false, error: 'The desktop app does not sign in, so there is no password to change here.' });
      return;
    }
    const result = await userDatabaseService.changeOwnPassword(identity.user.id, currentPassword, newPassword);
    reply('change-own-password', payload, sender, requestId,
      result.success ? { success: true } : { success: false, error: result.error });
  } catch (error) {
    reply('change-own-password', payload, sender, requestId, { success: false, error: (error as Error).message });
  }
});

/**
 * Tell every client the account list moved, and ask the web server to drop sessions whose
 * rights just changed so a demoted user does not keep their old permissions until logout.
 */
function broadcastUsersChanged(userId?: string, roleId?: string) {
  messagingService.sendToAll('users-changed', { userId, roleId });
  messagingService.invalidateWebSessions({ userId, roleId });
}
