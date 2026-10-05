import type { WebContents } from 'electron';
import type { AuthenticatedUser, SessionUser } from './auth.types';

/** A web client's message, relayed to main by the web server child. */
export interface ApiProcessSender {
  type: 'api-process';
  cid?: string;
  /** Resolved by main from the user database, never taken from the child as is. */
  user: AuthenticatedUser | null;
  authEnabled: boolean;
  send(channel: string, data: unknown): void;
}

/** A socket inside the web server child; the underscored fields are set on connection. */
export interface WebSocketClient {
  _cid?: string;
  _user?: SessionUser | null;
  _authEnabled?: boolean;
  /** The session the socket was opened with, so it can be closed when that session ends. */
  _sessionToken?: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}

/** `undefined` means the message came from main-process code itself. */
export type MessageSender = WebContents | ApiProcessSender | WebSocketClient | undefined;

/** Close codes the web UI acts on: after UNAUTHORIZED it waits for a sign-in, after anything else it reconnects. */
export const SOCKET_CLOSE = {
  UNAUTHORIZED: 4401,
  RECONNECT: 1012
} as const;

/** Who is behind a WebSocket handshake, as the web server child sees it. */
export interface SocketIdentity {
  user: SessionUser | null;
  authEnabled: boolean;
  allowed: boolean;
  sessionToken?: string;
}

/** The single web login. Main hashes the password, so plaintext never crosses the IPC channel. */
export interface WebAuthConfigUpdate {
  enabled: boolean;
  username: string;
  passwordHash: string;
}

export type ChildToMainMessage =
  | { type: 'server-ready'; port: number; message: string }
  | { type: 'server-error'; port: number; error: string }
  | {
      type: 'messaging-event';
      channel: string;
      payload: unknown;
      cid?: string;
      user?: SessionUser | null;
      authEnabled?: boolean;
    }
  | { type: 'auth-verify'; requestId: string; username: string; password: string };

/** Who receives a pool-scoped broadcast. Absent on a message means every socket. */
export interface BroadcastAudience {
  /** Account ids that receive it. */
  userIds: string[];
  /** Also the sockets with no account: authentication off, or the legacy single login. */
  owners: boolean;
}

export type MainToChildMessage =
  | { type: 'auth-verify-result'; requestId: string; user: AuthenticatedUser | null }
  | { type: 'invalidate-sessions'; userId?: string; roleId?: string }
  | { type: 'messaging-response'; channel: string; data: unknown; cid?: string }
  | { type: 'broadcast-web'; channel: string; data: unknown; excludeCid?: string; audience?: BroadcastAudience }
  | { type: 'update-auth-config'; authConfig: WebAuthConfigUpdate };
