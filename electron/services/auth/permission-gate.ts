import { AuthenticatedUser, Permission, ROLE_IDS } from '../../types/auth.types';
import type { WebContents } from 'electron';
import type { ApiProcessSender, MessageSender, WebSocketClient } from '../../types/messaging.types';
import { isChannelAllowed, permissionForChannel } from './channel-permissions';

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
 * Work out who is behind a message.
 *
 * An Electron `WebContents` is the app's own window on this machine. Whoever is at the keyboard
 * already owns the install, so it is treated as an administrator and never asked to sign in.
 * Anything from the web server child carries the account main resolved from the user database.
 */
export function identifySender(sender: MessageSender): SenderIdentity {
  if (!sender) return ANONYMOUS;

  if ((sender as ApiProcessSender).type === 'api-process') {
    const { user, authEnabled } = sender as ApiProcessSender;
    if (!user) {
      // Auth turned off in the web UI: the server is open to anyone who can reach it, which is
      // the pre-existing behaviour, so treat it as the local owner rather than locking the UI
      // out of itself.
      return authEnabled === false ? LOCAL_DESKTOP : ANONYMOUS;
    }
    return {
      user,
      permissions: user.permissions || [],
      isAdmin: user.roleId === ROLE_IDS.ADMIN,
      isLocalDesktop: false
    };
  }

  // A raw socket never reaches the bus today. If one did, its session snapshot is not
  // authoritative, and it must not fall through to the desktop's rights below.
  if ('readyState' in sender) {
    return (sender as WebSocketClient)._authEnabled === false ? LOCAL_DESKTOP : ANONYMOUS;
  }

  return LOCAL_DESKTOP;
}

/**
 * True only for the Electron window on this machine. Unlike identifySender, a web client never
 * counts, even with authentication off: for requests that name files on the host.
 */
export function isDesktopWindow(sender: MessageSender): sender is WebContents {
  return !!sender && (sender as ApiProcessSender).type !== 'api-process' && !('readyState' in sender);
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
export function authorizeChannel(channel: string, sender: MessageSender): AuthorizationResult {
  const identity = identifySender(sender);

  if (identity.isAdmin) return { allowed: true };

  if (!identity.user) {
    return { allowed: false, error: 'You must sign in to do that.' };
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
