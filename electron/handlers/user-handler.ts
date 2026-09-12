import { messagingService } from '../services/messaging.service';
import { userDatabaseService } from '../services/auth/user-database.service';
import { identifySender } from '../services/auth/permission-gate';
import { ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, BUILT_IN_ROLES } from '../types/auth.types';

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

/** The signed-in account, the permissions it holds, and whether accounts are in use at all. */
messagingService.on('get-current-user', (payload: any, sender: any) => {
  const { requestId } = payload || {};
  try {
    const identity = identifySender(sender);
    reply('get-current-user', payload, sender, requestId, {
      success: true,
      // The desktop window has no account; it is simply the owner of the machine.
      user: identity.user,
      isLocalDesktop: identity.isLocalDesktop,
      isAdmin: identity.isAdmin,
      permissions: identity.isAdmin ? [...ALL_PERMISSIONS] : identity.permissions,
      accountsInUse: userDatabaseService.hasAnyUser()
    });
  } catch (error) {
    reply('get-current-user', payload, sender, requestId, { success: false, error: (error as Error).message });
  }
});

messagingService.on('get-users', (payload: any, sender: any) => {
  const { requestId } = payload || {};
  try {
    reply('get-users', payload, sender, requestId, {
      success: true,
      users: userDatabaseService.listUsers(),
      roles: userDatabaseService.listRoles()
    });
  } catch (error) {
    reply('get-users', payload, sender, requestId, { success: false, error: (error as Error).message, users: [], roles: [] });
  }
});

messagingService.on('create-user', async (payload: any, sender: any) => {
  const { requestId, username, password, displayName, roleId, active } = payload || {};
  try {
    const result = await userDatabaseService.createUser({ username, password, displayName, roleId, active });
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
    // Changing your own role or disabling yourself is a foot-gun; block it outright.
    if (identity.user && identity.user.id === id) {
      if ((payload.roleId && payload.roleId !== identity.user.roleId) || payload.active === false) {
        reply('update-user', payload, sender, requestId,
          { success: false, error: 'You cannot change your own role or disable your own account.' });
        return;
      }
    }

    const result = await userDatabaseService.updateUser({
      id,
      username: payload.username,
      displayName: payload.displayName,
      roleId: payload.roleId,
      active: payload.active,
      password: payload.password
    });
    reply('update-user', payload, sender, requestId,
      result.success ? { success: true, user: result.data } : { success: false, error: result.error });
    if (result.success) broadcastUsersChanged(id);
  } catch (error) {
    reply('update-user', payload, sender, requestId, { success: false, error: (error as Error).message });
  }
});

messagingService.on('delete-user', (payload: any, sender: any) => {
  const { requestId, id } = payload || {};
  try {
    const identity = identifySender(sender);
    if (identity.user && identity.user.id === id) {
      reply('delete-user', payload, sender, requestId, { success: false, error: 'You cannot delete your own account.' });
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
