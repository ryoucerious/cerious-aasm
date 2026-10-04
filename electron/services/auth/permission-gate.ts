import { AuthenticatedUser, effectivePermissions, PERMISSIONS, Permission, ROLE_IDS } from '../../types/auth.types';
import { isChannelAllowed, permissionForChannel } from './channel-permissions';
import { userDatabaseService } from './user-database.service';

/**
 * Account channels an operator may open. The handler still checks the separate
 * create and delete permissions, and refuses anything outside that operator's group.
 * Changing role definitions is not in this set.
 */
const OPERATOR_POOL_CHANNELS = new Set([
  'list-server-managers',
  'create-server-manager',
  'assign-server-manager',
  'get-users',
  'get-roles',
  'create-user',
  'update-user',
  'delete-user'
]);

function holdsAnyAccountPermission(permissions: Permission[]): boolean {
  return permissions.some(permission => permission === PERMISSIONS.USERS_MANAGE || permission.startsWith('accounts.'));
}

/** What a message sender is allowed to do. */
export interface SenderIdentity {
  /** null for the local desktop app, which is not a database account. */
  user: AuthenticatedUser | null;
  permissions: Permission[];
  isAdmin: boolean;
  /** True for the Electron window on this machine. */
  isLocalDesktop: boolean;
}

/** The desktop window is the machine owner, so it acts with full rights and no login. */
const LOCAL_DESKTOP: SenderIdentity = { user: null, permissions: [], isAdmin: true, isLocalDesktop: true };

/** Nobody: an unauthenticated web client. */
const ANONYMOUS: SenderIdentity = { user: null, permissions: [], isAdmin: false, isLocalDesktop: false };

/**
 * The session cookie is a snapshot from sign-in. Read the role from the database so a change
 * to what that role may do applies without asking the person to sign in again.
 * If the database cannot be read, the snapshot is used and the panel stays up.
 */
function withCurrentRole(user: AuthenticatedUser): AuthenticatedUser {
  if (user.id === 'legacy-admin') return user;
  try {
    const fresh = userDatabaseService.getUser(user.id);
    const roleId = fresh?.roleId || user.roleId;
    const role = roleId ? userDatabaseService.getRole(roleId) : null;
    if (!role) return user;
    return {
      ...user,
      username: fresh?.username || user.username,
      displayName: fresh?.displayName || user.displayName,
      roleId,
      ownerUserId: fresh?.ownerUserId ?? user.ownerUserId ?? null,
      roleName: role.name || user.roleName,
      permissions: effectivePermissions(role)
    };
  } catch {
    return user;
  }
}

/**
 * Work out who is behind a message.
 *
 * Two kinds of sender reach the bus. An Electron `WebContents` is the app's own window on
 * this machine — whoever is at the keyboard already owns the install, so it is treated as an
 * administrator and never asked to sign in, which is how the desktop app behaved before
 * accounts existed. Anything from the web server child carries the account resolved from the
 * session cookie at the WebSocket handshake.
 */
export function identifySender(sender: any): SenderIdentity {
  if (!sender) return ANONYMOUS;

  // The api-process wrapper is a plain object tagged by web-server.service.
  if (sender.type === 'api-process') {
    const raw: AuthenticatedUser | null = sender.user || null;
    if (!raw) {
      // Auth turned off in the web UI: the server is open to anyone who can reach it, which
      // is the pre-existing behaviour, so treat it as the local owner rather than locking
      // the UI out of itself.
      return sender.authEnabled === false ? LOCAL_DESKTOP : ANONYMOUS;
    }
    const user = withCurrentRole(raw);
    return {
      user,
      permissions: user.permissions || [],
      isAdmin: user.roleId === ROLE_IDS.ADMIN,
      isLocalDesktop: false
    };
  }

  // A WebSocket handled in-process (no web-server child). attachWebSocketServer stamps the
  // resolved account onto the socket at handshake time.
  if (sender._cid !== undefined || sender._user !== undefined) {
    const user: AuthenticatedUser | null = sender._user ? withCurrentRole(sender._user) : null;
    if (!user) {
      return sender._authEnabled === false ? LOCAL_DESKTOP : ANONYMOUS;
    }
    return {
      user,
      permissions: user.permissions || [],
      isAdmin: user.roleId === ROLE_IDS.ADMIN,
      isLocalDesktop: false
    };
  }

  // Anything else is in-process: the Electron window's WebContents, or an internal caller.
  // Whoever is at the keyboard already owns the install, so it acts as an administrator.
  return LOCAL_DESKTOP;
}

export interface AuthorizationResult {
  allowed: boolean;
  /** Set when refused, ready to show to the user. */
  error?: string;
}

/**
 * Decide whether a sender may use a channel.
 *
 * Deny-by-default: a channel with no entry in the permission map is refused for everyone but
 * an administrator, so shipping a handler without classifying it fails closed.
 */
export function authorizeChannel(channel: string, sender: any): AuthorizationResult {
  const identity = identifySender(sender);

  if (identity.isAdmin) return { allowed: true };

  if (!identity.user) {
    return { allowed: false, error: 'You must sign in to do that.' };
  }

  if (OPERATOR_POOL_CHANNELS.has(channel) && (identity.user.roleId === ROLE_IDS.OPERATOR || holdsAnyAccountPermission(identity.permissions))) {
    return { allowed: true };
  }

  // Adding a server and editing one share this channel. Creating needs servers.create
  // (Admin and Operator). Editing an existing server needs servers.configure (a server
  // manager). The handler refuses the half the role does not have.
  if (channel === 'save-server-instance') {
    const permissions = identity.permissions || [];
    if (permissions.includes(PERMISSIONS.SERVERS_CREATE) || permissions.includes(PERMISSIONS.SERVERS_CONFIGURE)) {
      return { allowed: true };
    }
  }

  if (isChannelAllowed(channel, identity.permissions, identity.isAdmin)) {
    return { allowed: true };
  }

  const required = permissionForChannel(channel);
  return {
    allowed: false,
    error: required
      ? `Your role does not allow this (${required} required).`
      : 'Your role does not allow this.'
  };
}
