import { EventEmitter } from 'events';
import { fork } from 'child_process';
import { WebServerService } from './web-server.service';
import { messagingService } from './messaging.service';
import { userDatabaseService } from './auth/user-database.service';
import { settingsService } from './settings.service';
import { registerMeshAuth, setMeshMember } from './mesh/mesh-hooks';
import * as globalConfigUtils from '../utils/global-config.utils';
import { ALL_PERMISSIONS, AuthenticatedUser, SessionUser } from '../types/auth.types';
import type { ChildToMainMessage } from '../types/messaging.types';

jest.mock('./auth/user-database.service', () => ({
  userDatabaseService: { getAuthenticatedUser: jest.fn(), verifyCredentials: jest.fn() }
}));
jest.mock('./settings.service', () => ({ settingsService: { buildWebAuthConfig: jest.fn() } }));
jest.mock('../utils/global-config.utils', () => ({ loadGlobalConfig: jest.fn() }));

class FakeChild extends EventEmitter {
  connected = true;
  killed = false;
  send = jest.fn();
  kill = jest.fn();

  receive(message: ChildToMainMessage) {
    this.emit('message', message);
  }

  replies() {
    return this.send.mock.calls.map(([message]) => message).filter(message => message.type === 'messaging-response');
  }
}

const mockedFork = jest.mocked(fork);
const mockedGetUser = jest.mocked(userDatabaseService.getAuthenticatedUser);

function account(roleId: string, overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'u1', username: 'sam', displayName: 'Sam', roleId, roleName: roleId,
    permissions: roleId === 'admin' ? [...ALL_PERMISSIONS] : ['servers.view'],
    active: true, ownerUserId: null, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null, ...overrides
  };
}

/** What the child claims from the session cookie, which may be stale. */
function claim(roleId: string, id = 'u1'): SessionUser {
  const { cliLocked, createdAt, updatedAt, lastLoginAt, ...snapshot } = account(roleId, { id });
  return snapshot;
}

describe('WebServerService', () => {
  let service: WebServerService;
  let children: FakeChild[];
  let sendToAll: jest.SpyInstance;

  beforeEach(() => {
    service = new WebServerService();
    children = [];
    mockedFork.mockImplementation(() => {
      const child = new FakeChild();
      children.push(child);
      return child as never;
    });
    sendToAll = jest.spyOn(messagingService, 'sendToAll').mockImplementation(() => {});
    jest.mocked(globalConfigUtils.loadGlobalConfig).mockReturnValue({
      startWebServerOnLoad: false, webServerPort: 3000, authenticationEnabled: false,
      authenticationUsername: '', authenticationPassword: '', maxBackupDownloadSizeMB: 100
    });
  });

  afterEach(() => {
    service.cleanup();
    messagingService.removeAllListeners();
    jest.useRealTimers();
  });

  async function startReady(port = 3000): Promise<FakeChild> {
    const started = service.startWebServer(port);
    const child = children[children.length - 1];
    child.receive({ type: 'server-ready', port, message: `Server started on port ${port}` });
    await expect(started).resolves.toMatchObject({ success: true });
    return child;
  }

  describe('starting', () => {
    it('forks the child with the port and the user database flag', async () => {
      await startReady(8080);

      expect(mockedFork).toHaveBeenCalledWith(
        expect.stringMatching(/web-server[\\/]server\.js$/),
        ['--port=8080'],
        { env: expect.objectContaining({ AASM_USER_DB: '1', ELECTRON_RUN_AS_NODE: '1', PORT: '8080' }) }
      );
    });

    it('passes a login to the child through its environment', async () => {
      const started = service.startWebServer(3000, { enabled: true, username: 'admin', password: 'secret' });
      children[0].receive({ type: 'server-ready', port: 3000, message: 'ok' });
      await started;

      expect(mockedFork.mock.calls[0][2]!.env).toMatchObject({ AUTH_ENABLED: 'true', AUTH_USERNAME: 'admin', AUTH_PASSWORD: 'secret' });
    });

    it('reports success once the child listens, and tells every client', async () => {
      const child = await startReady();

      expect(service.getStatus()).toEqual({ running: true, port: 3000 });
      expect(messagingService.getApiProcess()).toBe(child);
      expect(sendToAll).toHaveBeenCalledWith('web-server-status', { running: true, port: 3000 });
    });

    it('reports failure when the port is taken', async () => {
      const started = service.startWebServer(3000);
      children[0].receive({ type: 'server-error', port: 3000, error: 'listen EADDRINUSE: address already in use :::3000' });

      await expect(started).resolves.toEqual({ success: false, message: 'listen EADDRINUSE: address already in use :::3000', port: 3000 });
      expect(service.getStatus().running).toBe(false);
    });

    it('reports failure when the child exits before it is ready, even with code 0', async () => {
      const started = service.startWebServer(3000);
      children[0].emit('exit', 0);

      await expect(started).resolves.toEqual({ success: false, message: 'Server process exited with code 0', port: 3000 });
      expect(messagingService.getApiProcess()).toBeNull();
    });

    it('gives up after 10 seconds without an answer', async () => {
      jest.useFakeTimers();
      const started = service.startWebServer(3000);

      jest.advanceTimersByTime(10_000);

      await expect(started).resolves.toEqual({ success: false, message: 'Server startup timed out', port: 3000 });
    });

    it('clears the startup timer once the child is ready', async () => {
      jest.useFakeTimers();
      await startReady();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('does not start a second child while one is starting or already running on that port', async () => {
      const first = service.startWebServer(3000);
      await expect(service.startWebServer(3000)).resolves.toMatchObject({ success: true, message: 'Web server already starting' });
      children[0].receive({ type: 'server-ready', port: 3000, message: 'ok' });
      await first;

      await expect(service.startWebServer(3000)).resolves.toMatchObject({ success: true, message: 'Web server already running' });
      expect(mockedFork).toHaveBeenCalledTimes(1);
    });
  });

  describe('the child going away', () => {
    it('clears the child everywhere and tells every client', async () => {
      const child = await startReady();
      sendToAll.mockClear();

      child.emit('exit', 1);

      expect(service.getStatus().running).toBe(false);
      expect(messagingService.getApiProcess()).toBeNull();
      expect(sendToAll).toHaveBeenCalledWith('web-server-status', { running: false, port: 3000 });
    });

    it('ignores a late exit from a child it has already replaced', async () => {
      jest.useFakeTimers();
      const first = await startReady(3000);

      // The first child ignores SIGTERM, so the stop falls back to SIGKILL after 5 seconds.
      const stopped = service.stopWebServer();
      jest.advanceTimersByTime(5_000);
      await expect(stopped).resolves.toEqual({ success: true, message: 'Web server force stopped' });
      expect(first.kill).toHaveBeenLastCalledWith('SIGKILL');

      const second = await startReady(3001);
      first.emit('exit', null);

      expect(service.getStatus()).toEqual({ running: true, port: 3001 });
      expect(messagingService.getApiProcess()).toBe(second);
    });

    it('ignores messages from a child it has already replaced', async () => {
      const first = await startReady(3000);
      const stopped = service.stopWebServer();
      first.emit('exit', 0);
      await stopped;
      await startReady(3001);

      first.receive({ type: 'server-error', port: 3000, error: 'late' });

      expect(service.getStatus()).toEqual({ running: true, port: 3001 });
    });
  });

  describe('stopping', () => {
    it('stops the child and waits for it to exit', async () => {
      const child = await startReady();
      child.kill.mockImplementation(() => child.emit('exit', 0));

      await expect(service.stopWebServer()).resolves.toEqual({ success: true, message: 'Web server stopped successfully' });
      expect(service.getStatus().running).toBe(false);
    });

    it('says so when nothing is running', async () => {
      await expect(service.stopWebServer()).resolves.toEqual({ success: true, message: 'Web server was not running' });
    });

    it('cleanup kills the child and forgets it, without a status broadcast at shutdown', async () => {
      const child = await startReady();
      sendToAll.mockClear();

      service.cleanup();

      expect(child.kill).toHaveBeenCalled();
      expect(messagingService.getApiProcess()).toBeNull();
      expect(service.getStatus().running).toBe(false);
      expect(sendToAll).not.toHaveBeenCalled();
    });
  });

  describe('the global login', () => {
    beforeEach(() => {
      jest.mocked(globalConfigUtils.loadGlobalConfig).mockReturnValue({
        startWebServerOnLoad: false, webServerPort: 3000, authenticationEnabled: true,
        authenticationUsername: 'admin', authenticationPassword: 'secret', maxBackupDownloadSizeMB: 100
      });
      jest.mocked(settingsService.buildWebAuthConfig).mockResolvedValue({ enabled: true, username: 'admin', passwordHash: 'hash' });
    });

    it('is handed to the child once it is ready', async () => {
      const child = await startReady();
      await new Promise(resolve => setImmediate(resolve));

      expect(child.send).toHaveBeenCalledWith({
        type: 'update-auth-config', authConfig: { enabled: true, username: 'admin', passwordHash: 'hash' }
      });
    });

    it('is left alone when the command line provides the login', async () => {
      service.useCommandLineLogin({ enabled: true, username: 'ops', password: 'cli-secret' });

      const child = await startReady();
      await new Promise(resolve => setImmediate(resolve));

      expect(settingsService.buildWebAuthConfig).not.toHaveBeenCalled();
      expect(child.send).not.toHaveBeenCalled();
    });
  });

  describe('the command-line login', () => {
    const cli = { enabled: true, username: 'ops', password: 'cli-secret' };

    it('is reported', () => {
      expect(service.usesCommandLineLogin()).toBe(false);

      service.useCommandLineLogin(cli);

      expect(service.usesCommandLineLogin()).toBe(true);
    });

    it('is what every later start uses, whatever login it is handed', async () => {
      service.useCommandLineLogin(cli);

      const started = service.startWebServer(3001, { enabled: false, username: '', password: '' });
      children[0].receive({ type: 'server-ready', port: 3001, message: 'ok' });
      await started;

      expect(mockedFork.mock.calls[0][2]!.env).toMatchObject({ AUTH_ENABLED: 'true', AUTH_USERNAME: 'ops', AUTH_PASSWORD: 'cli-secret' });
    });
  });

  describe('messages from web clients', () => {
    let child: FakeChild;

    beforeEach(async () => {
      child = await startReady();
    });

    function relay(channel: string, user: SessionUser | null, payload: unknown = { requestId: 'r1' }) {
      child.receive({ type: 'messaging-event', channel, payload, cid: 'c1', user, authEnabled: true });
    }

    it('authorises a stale Admin snapshot as the Viewer the account is now', () => {
      mockedGetUser.mockReturnValue(account('viewer'));
      const listener = jest.fn();
      messagingService.on('get-server-instances', listener);
      messagingService.on('set-global-config', listener);

      relay('get-server-instances', claim('admin'));
      relay('set-global-config', claim('admin'));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][1]).toMatchObject({ type: 'api-process', cid: 'c1', user: account('viewer') });
      expect(child.replies()).toEqual([{
        type: 'messaging-response',
        channel: 'set-global-config',
        data: expect.objectContaining({ success: false, forbidden: true, requestId: 'r1' }),
        cid: 'c1'
      }]);
      expect(mockedGetUser).toHaveBeenCalledWith('u1');
    });

    it.each([
      ['a deleted account', null],
      ['a disabled account', account('admin', { active: false })]
    ])('refuses %s', (_label, fresh) => {
      mockedGetUser.mockReturnValue(fresh);
      const listener = jest.fn();
      messagingService.on('get-server-instances', listener);

      relay('get-server-instances', claim('admin'));

      expect(listener).not.toHaveBeenCalled();
      expect(child.replies()[0].data).toMatchObject({ success: false, error: 'You must sign in to do that.' });
    });

    it.each([
      ['deleted', null],
      ['disabled', account('viewer', { active: false })]
    ])('ends the web sessions of an account %s while the web server was down', (_label, fresh) => {
      // Otherwise the child keeps treating the client as signed in and every request is refused.
      mockedGetUser.mockReturnValue(fresh);

      relay('get-server-instances', claim('viewer'));

      const sent = child.send.mock.calls.map(([message]) => message.type);
      expect(sent).toEqual(['messaging-response', 'invalidate-sessions']);
      expect(child.send).toHaveBeenCalledWith({ type: 'invalidate-sessions', userId: 'u1' });
    });

    it('refuses everyone while the user database cannot be read', () => {
      mockedGetUser.mockImplementation(() => { throw new Error('The user database is in use by another running instance.'); });
      const listener = jest.fn();
      messagingService.on('get-server-instances', listener);

      relay('get-server-instances', claim('admin'));

      expect(listener).not.toHaveBeenCalled();
      // The account may well exist; a database hiccup must not sign anyone out.
      expect(child.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'invalidate-sessions' }));
    });

    it('keeps the legacy single login an admin', () => {
      const listener = jest.fn();
      messagingService.on('set-global-config', listener);

      relay('set-global-config', { ...claim('admin', 'legacy-admin'), username: 'admin' });

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][1].user).toMatchObject({ id: 'legacy-admin', username: 'admin', roleId: 'admin' });
      expect(mockedGetUser).not.toHaveBeenCalled();
    });

    it('lets everyone through as the owner while authentication is off', () => {
      const listener = jest.fn();
      messagingService.on('set-global-config', listener);

      child.receive({ type: 'messaging-event', channel: 'set-global-config', payload: {}, cid: 'c1', user: null, authEnabled: false });

      expect(listener).toHaveBeenCalled();
    });

    it('sends the reply back to the asking client through the child', () => {
      mockedGetUser.mockReturnValue(account('viewer'));
      messagingService.on('get-server-instances', (_payload, sender) => sender.send('get-server-instances', { instances: [] }));

      relay('get-server-instances', claim('viewer'));

      expect(child.replies()).toEqual([
        { type: 'messaging-response', channel: 'get-server-instances', data: { instances: [] }, cid: 'c1' }
      ]);
    });

    it('survives a handler that throws', () => {
      mockedGetUser.mockReturnValue(account('viewer'));
      messagingService.on('get-server-instances', () => { throw new TypeError('payload is undefined'); });

      expect(() => relay('get-server-instances', claim('viewer'), undefined)).not.toThrow();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('get-server-instances'), expect.any(TypeError));
    });

    it('checks credentials for the child against the user database', async () => {
      jest.mocked(userDatabaseService.verifyCredentials).mockResolvedValue(account('viewer'));

      child.receive({ type: 'auth-verify', requestId: 'auth-1', username: 'sam', password: 'pw' });
      await new Promise(resolve => setImmediate(resolve));

      expect(userDatabaseService.verifyCredentials).toHaveBeenCalledWith('sam', 'pw');
      expect(child.send).toHaveBeenCalledWith({ type: 'auth-verify-result', requestId: 'auth-1', user: account('viewer') });
    });
  });

  // A member's web interface controls servers on every node, so it needs a mesh account
  // even where this machine's own login is off.
  describe('in a mesh', () => {
    const mesh = {
      enabled: () => true,
      verify: jest.fn(async () => null),
      resolve: jest.fn(async () => null),
      hasQuorum: () => true
    };

    afterEach(() => {
      registerMeshAuth(null);
      setMeshMember(false);
    });

    function anonymous(child: FakeChild): jest.Mock {
      const listener = jest.fn();
      messagingService.on('set-global-config', listener);
      child.receive({ type: 'messaging-event', channel: 'set-global-config', payload: { requestId: 'r1' }, cid: 'c1', user: null, authEnabled: false });
      return listener;
    }

    it('tells the child that sign-in is required once it is ready', async () => {
      setMeshMember(true);

      const child = await startReady();

      expect(child.send).toHaveBeenCalledWith({ type: 'mesh-sign-in', required: true });
    });

    it('tells the running child when this node joins and when it leaves', async () => {
      const child = await startReady();

      setMeshMember(true);
      setMeshMember(false);

      expect(child.send.mock.calls.map(([message]) => message).filter(message => message.type === 'mesh-sign-in'))
        .toEqual([{ type: 'mesh-sign-in', required: true }, { type: 'mesh-sign-in', required: false }]);
    });

    it('treats a web client without an account as signed out, even when the child says authentication is off', async () => {
      const child = await startReady();
      setMeshMember(true);
      registerMeshAuth(mesh);

      expect(anonymous(child)).not.toHaveBeenCalled();
      expect(child.replies()[0].data).toMatchObject({ success: false, error: 'You must sign in to do that.' });
    });

    it('does the same while this node is still reaching its mesh after a restart', async () => {
      const child = await startReady();
      setMeshMember(true);

      expect(anonymous(child)).not.toHaveBeenCalled();
      expect(child.replies()[0].data).toMatchObject({ success: false, error: 'You must sign in to do that.' });
    });
  });
});
