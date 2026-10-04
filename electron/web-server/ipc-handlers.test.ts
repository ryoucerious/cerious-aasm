import { setupIPCHandlers } from './ipc-handlers';
import { messagingService } from '../services/messaging.service';
import { getAuthConfig, updateAuthConfig } from './auth-config';
import { resolveAuthVerify } from './user-bridge';
import { invalidateSessionsFor } from '../utils/session-store.utils';
import type { MainToChildMessage } from '../types/messaging.types';

jest.mock('../services/messaging.service', () => ({
  messagingService: { sendToWebSocket: jest.fn(), sendToAllWebSockets: jest.fn(), closeWebSockets: jest.fn() }
}));
jest.mock('./auth-config', () => ({ updateAuthConfig: jest.fn(), getAuthConfig: jest.fn() }));
jest.mock('./user-bridge', () => ({ resolveAuthVerify: jest.fn() }));
jest.mock('../utils/session-store.utils', () => ({ invalidateSessionsFor: jest.fn(() => []) }));

const off = { enabled: false, username: '', passwordHash: '' };
const on = { enabled: true, username: 'admin', passwordHash: 'hash' };

describe('ipc-handlers', () => {
  let onMessage: (message: unknown) => void;

  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const on = jest.spyOn(process, 'on').mockImplementation(() => process);
    setupIPCHandlers();
    const registration = on.mock.calls.find(([event]) => event === 'message');
    onMessage = registration![1] as (message: unknown) => void;
  });

  function receive(message: MainToChildMessage) {
    onMessage(message);
  }

  it('sends a reply only to the socket that asked', () => {
    receive({ type: 'messaging-response', channel: 'get-users', data: { users: [] }, cid: 'c1' });

    expect(messagingService.sendToWebSocket).toHaveBeenCalledWith('c1', 'get-users', { users: [] });
    expect(messagingService.sendToAllWebSockets).not.toHaveBeenCalled();
  });

  it('broadcasts to every socket but the excluded one', () => {
    receive({ type: 'broadcast-web', channel: 'server-instances', data: [], excludeCid: 'c1' });

    expect(messagingService.sendToAllWebSockets).toHaveBeenCalledWith('server-instances', [], 'c1');
  });

  it('hands a credential check result to the waiting login', () => {
    receive({ type: 'auth-verify-result', requestId: 'auth-1', user: null });

    expect(resolveAuthVerify).toHaveBeenCalledWith('auth-1', null);
  });

  it('drops the sessions of a changed account or role and closes their sockets', () => {
    jest.mocked(invalidateSessionsFor).mockReturnValueOnce(['t1']);

    receive({ type: 'invalidate-sessions', userId: 'u1' });

    expect(invalidateSessionsFor).toHaveBeenCalledWith({ userId: 'u1', roleId: undefined });
    expect(messagingService.closeWebSockets).toHaveBeenCalledWith(4401, 'Session ended', expect.any(Function));
    const matches = jest.mocked(messagingService.closeWebSockets).mock.calls[0][2]!;
    expect(matches({ _sessionToken: 't1', readyState: 1, send: jest.fn(), close: jest.fn() })).toBe(true);
    expect(matches({ _sessionToken: 't2', readyState: 1, send: jest.fn(), close: jest.fn() })).toBe(false);
    expect(matches({ readyState: 1, send: jest.fn(), close: jest.fn() })).toBe(false);
  });

  it('closes nothing when no session was dropped', () => {
    receive({ type: 'invalidate-sessions', roleId: 'viewer' });

    expect(messagingService.closeWebSockets).not.toHaveBeenCalled();
  });

  it('applies a login update', () => {
    jest.mocked(getAuthConfig).mockReturnValueOnce(on).mockReturnValueOnce(on);

    receive({ type: 'update-auth-config', authConfig: on });

    expect(updateAuthConfig).toHaveBeenCalledWith(on);
  });

  it('makes every socket sign in again when the login changes', () => {
    // A socket opened while authentication was off would otherwise keep the owner's rights.
    jest.mocked(getAuthConfig).mockReturnValueOnce(off).mockReturnValueOnce(on);

    receive({ type: 'update-auth-config', authConfig: on });

    expect(messagingService.closeWebSockets).toHaveBeenCalledWith(1012, 'Sign-in settings changed');
  });

  it('leaves the sockets open when the login did not change', () => {
    jest.mocked(getAuthConfig).mockReturnValue(on);

    receive({ type: 'update-auth-config', authConfig: on });

    expect(messagingService.closeWebSockets).not.toHaveBeenCalled();
  });

  it('never stores fields beyond the login itself', () => {
    // An older main sent the plaintext password along, and spreading the message saved it to disk.
    const authConfig = { enabled: false, username: 'admin', passwordHash: 'hash', password: 'plaintext' };
    jest.mocked(getAuthConfig).mockReturnValue(off);

    receive({ type: 'update-auth-config', authConfig });

    expect(updateAuthConfig).toHaveBeenCalledWith({ enabled: false, username: 'admin', passwordHash: 'hash' });
  });

  it('ignores messages it does not know', () => {
    expect(() => onMessage({ type: 'unknown-type' })).not.toThrow();
    expect(() => onMessage(undefined)).not.toThrow();
    expect(updateAuthConfig).not.toHaveBeenCalled();
  });
});
