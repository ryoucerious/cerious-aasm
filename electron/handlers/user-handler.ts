import { messagingService } from '../services/messaging.service';
import { userDatabaseService } from '../services/auth/user-database.service';
import { identifySender, SenderIdentity } from '../services/auth/permission-gate';
import { ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, BUILT_IN_ROLES, Permission, ROLE_IDS } from '../types/auth.types';
import { onRequest } from './handler.utils';

/**
 * Accounts: users, roles and the current session's identity.
 *
 * MessagingService checks each channel's permission before these run (see channel-permissions).
 * What depends on who is asking is checked here: editing or deleting yourself, and a non-admin
 * handing out more rights than they hold.
 */

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

onRequest('get-users', () => ({
  success: true,
  users: userDatabaseService.listUsers(),
  roles: userDatabaseService.listRoles()
}), { onError: message => ({ success: false, error: message, users: [], roles: [] }) });

onRequest('create-user', async (payload, { sender, afterReply }) => {
  const { username, password, displayName, roleId, active } = payload;
  const refusal = roleAssignmentRefusal(identifySender(sender), roleId);
  if (refusal) return { success: false, error: refusal };

  const result = await userDatabaseService.createUser({ username, password, displayName, roleId, active });
  if (!result.success) return { success: false, error: result.error };
  afterReply(() => broadcastUsersChanged());
  return { success: true, user: result.data };
});

onRequest('update-user', async (payload, { sender, afterReply }) => {
  const { id } = payload;
  const identity = identifySender(sender);
  // Changing your own role or disabling yourself is a foot-gun; block it outright.
  if (identity.user && identity.user.id === id) {
    if ((payload.roleId && payload.roleId !== identity.user.roleId) || payload.active === false) {
      return { success: false, error: 'You cannot change your own role or disable your own account.' };
    }
  }
  const refusal = accountRefusal(identity, id) ?? roleAssignmentRefusal(identity, payload.roleId);
  if (refusal) return { success: false, error: refusal };

  const result = await userDatabaseService.updateUser({
    id,
    username: payload.username,
    displayName: payload.displayName,
    roleId: payload.roleId,
    active: payload.active,
    password: payload.password
  });
  if (!result.success) return { success: false, error: result.error };
  afterReply(() => broadcastUsersChanged(id));
  return { success: true, user: result.data };
});

onRequest('delete-user', (payload, { sender, afterReply }) => {
  const { id } = payload;
  const identity = identifySender(sender);
  if (identity.user && identity.user.id === id) {
    return { success: false, error: 'You cannot delete your own account.' };
  }
  const refusal = accountRefusal(identity, id);
  if (refusal) return { success: false, error: refusal };

  const result = userDatabaseService.deleteUser(id);
  if (!result.success) return { success: false, error: result.error };
  afterReply(() => broadcastUsersChanged(id));
  return { success: true, id };
});

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
  messagingService.sendToAll('users-changed', { userId, roleId });
  messagingService.invalidateWebSessions({ userId, roleId });
}
