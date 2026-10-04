import { EventEmitter } from 'events';
import type { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocketServer } from 'ws';
import { BusObserver, MessagingService, isSameOriginUpgrade } from './messaging.service';
import type { ApiProcessSender, SocketIdentity } from '../types/messaging.types';
import type { AuthenticatedUser } from '../types/auth.types';

jest.mock('ws', () => ({ ...jest.requireActual('ws'), WebSocketServer: jest.fn() }));

const MockedWebSocketServer = jest.mocked(WebSocketServer);

function upgrade(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function socket(cid?: string, readyState = 1) {
  return Object.assign(new EventEmitter(), {
    _cid: cid,
    _sessionToken: undefined as string | undefined,
    readyState,
    send: jest.fn(),
    close: jest.fn()
  });
}

const viewer: AuthenticatedUser = {
  id: 'u1', username: 'viewer1', displayName: 'Viewer', roleId: 'viewer', roleName: 'Viewer',
  permissions: ['servers.view'], active: true, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null
};

function webSender(user: AuthenticatedUser | null, authEnabled = true): ApiProcessSender {
  return { type: 'api-process', cid: 'c1', user, authEnabled, send: jest.fn() };
}

describe('MessagingService', () => {
  let service: MessagingService;

  beforeEach(() => {
    service = new MessagingService();
  });

  describe('emit', () => {
    it('runs listeners for main-process callers, which carry no sender', () => {
      const listener = jest.fn();
      service.on('set-global-config', listener);

      service.emit('set-global-config', { requestId: 'r1' });

      expect(listener).toHaveBeenCalledWith({ requestId: 'r1' });
    });

    it('refuses a web client whose role lacks the permission and tells it why', () => {
      const listener = jest.fn();
      service.on('set-global-config', listener);
      const sender = webSender(viewer);

      expect(service.emit('set-global-config', { requestId: 'r1' }, sender)).toBe(false);

      expect(listener).not.toHaveBeenCalled();
      expect(sender.send).toHaveBeenCalledWith('set-global-config', {
        success: false, error: 'Your role does not allow this (settings.manage required).', forbidden: true, requestId: 'r1'
      });
    });

    it('lets a permitted web client through and credits the action to it', () => {
      const observer = { noteAction: jest.fn(), recordFromBroadcast: jest.fn() };
      service.setObserver(observer);
      const listener = jest.fn();
      service.on('get-server-instances', listener);
      const sender = webSender(viewer);

      service.emit('get-server-instances', {}, sender);

      expect(listener).toHaveBeenCalledWith({}, sender);
      expect(observer.noteAction).toHaveBeenCalledWith('get-server-instances', {}, 'viewer1');
    });

    it('does not let a failing observer stop a message', () => {
      const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
      service.setObserver({ noteAction: () => { throw new Error('db locked'); }, recordFromBroadcast: jest.fn() });
      const listener = jest.fn();
      service.on('get-server-instances', listener);

      service.emit('get-server-instances', {}, webSender(viewer));

      expect(listener).toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith('[messaging] Activity feed failed:', expect.any(Error));
    });
  });

  describe('sendToOriginator', () => {
    it('replies through the sender', () => {
      const sender = webSender(viewer);

      service.sendToOriginator('chan', { foo: 1 }, sender);

      expect(sender.send).toHaveBeenCalledWith('chan', { foo: 1 });
    });

    it('drops a reply that has no sender instead of broadcasting it', () => {
      const client = socket('a');
      (service as unknown as { wsServer: unknown }).wsServer = { clients: new Set([client]) };
      const child = { connected: true, send: jest.fn() };
      service.setApiProcess(child as never);

      service.sendToOriginator('chan', { secret: 1 }, undefined);

      expect(client.send).not.toHaveBeenCalled();
      expect(child.send).not.toHaveBeenCalled();
    });

    it('replies to a raw socket in the socket envelope', () => {
      const client = socket('a');

      service.sendToOriginator('chan', { foo: 1 }, client);

      expect(client.send).toHaveBeenCalledWith(JSON.stringify({ channel: 'chan', data: { foo: 1 } }));
    });
  });

  describe('sendToWebSocket', () => {
    let a: ReturnType<typeof socket>;
    let b: ReturnType<typeof socket>;

    beforeEach(() => {
      a = socket('a');
      b = socket('b');
      (service as unknown as { wsServer: unknown }).wsServer = { clients: new Set([a, b]) };
    });

    it('delivers only to the socket with that cid', () => {
      service.sendToWebSocket('b', 'chan', { foo: 1 });

      expect(b.send).toHaveBeenCalledWith(JSON.stringify({ channel: 'chan', data: { foo: 1 } }));
      expect(a.send).not.toHaveBeenCalled();
    });

    it.each([['an unknown', 'gone'], ['a missing', undefined]])('drops a reply with %s cid', (_label, cid) => {
      service.sendToWebSocket(cid, 'chan', { foo: 1 });

      expect(a.send).not.toHaveBeenCalled();
      expect(b.send).not.toHaveBeenCalled();
    });
  });

  describe('broadcasts', () => {
    it('sends to every open socket except the excluded one', () => {
      const a = socket('a');
      const b = socket('b');
      const closing = socket('c', 2);
      (service as unknown as { wsServer: unknown }).wsServer = { clients: new Set([a, b, closing]) };

      service.sendToAllWebSockets('chan', { foo: 1 }, 'a');

      expect(b.send).toHaveBeenCalledWith(JSON.stringify({ channel: 'chan', data: { foo: 1 } }));
      expect(a.send).not.toHaveBeenCalled();
      expect(closing.send).not.toHaveBeenCalled();
    });

    it('sendToAll reaches renderers, web clients and the activity feed', () => {
      const observer: BusObserver = { noteAction: jest.fn(), recordFromBroadcast: jest.fn() };
      service.setObserver(observer);
      const renderer = { send: jest.fn(), on: jest.fn() };
      service.addWebContents(renderer as never);
      const child = { connected: true, send: jest.fn() };
      service.setApiProcess(child as never);

      service.sendToAll('chan', { foo: 1 });

      expect(renderer.send).toHaveBeenCalledWith('chan', { foo: 1 });
      expect(child.send).toHaveBeenCalledWith({ type: 'broadcast-web', channel: 'chan', data: { foo: 1 }, excludeCid: undefined });
      expect(observer.recordFromBroadcast).toHaveBeenCalledWith('chan', { foo: 1 });
    });

    it('sendToAllOthers skips the sender', () => {
      const own = { send: jest.fn(), on: jest.fn() };
      const other = { send: jest.fn(), on: jest.fn() };
      service.addWebContents(own as never);
      service.addWebContents(other as never);
      const child = { connected: true, send: jest.fn() };
      service.setApiProcess(child as never);

      service.sendToAllOthers('chan', { foo: 1 }, own as never);
      service.sendToAllOthers('chan', { foo: 2 }, webSender(viewer));

      expect(own.send).not.toHaveBeenCalledWith('chan', { foo: 1 });
      expect(other.send).toHaveBeenCalledWith('chan', { foo: 1 });
      expect(child.send).toHaveBeenCalledWith({ type: 'broadcast-web', channel: 'chan', data: { foo: 2 }, excludeCid: 'c1' });
    });

    it('sends nothing to a web server child that has gone away', () => {
      const child = { connected: false, send: jest.fn() };
      service.setApiProcess(child as never);

      service.broadcastToWebClients('chan', {});
      service.invalidateWebSessions({ userId: 'u1' });

      expect(child.send).not.toHaveBeenCalled();
    });

    it('asks the web server child to drop sessions', () => {
      const child = { connected: true, send: jest.fn() };
      service.setApiProcess(child as never);

      service.invalidateWebSessions({ roleId: 'viewer' });

      expect(child.send).toHaveBeenCalledWith({ type: 'invalidate-sessions', roleId: 'viewer' });
      expect(service.getApiProcess()).toBe(child);
    });
  });

  it('forgets a renderer once it is destroyed', () => {
    const renderer = { send: jest.fn(), on: jest.fn((event: string, callback: () => void) => { if (event === 'destroyed') callback(); }) };
    service.addWebContents(renderer as never);

    service.sendToAllRenderers('chan', {});

    expect(renderer.send).not.toHaveBeenCalled();
  });

  describe('closeWebSockets', () => {
    it('closes the open sockets that match, with the given code', () => {
      const a = Object.assign(socket('a'), { _sessionToken: 't1' });
      const b = Object.assign(socket('b'), { _sessionToken: 't2' });
      (service as unknown as { wsServer: unknown }).wsServer = { clients: new Set([a, b]) };

      expect(service.closeWebSockets(4401, 'Session ended', client => client._sessionToken === 't1')).toBe(1);
      expect(a.close).toHaveBeenCalledWith(4401, 'Session ended');
      expect(b.close).not.toHaveBeenCalled();

      expect(service.closeWebSockets(1012, 'Sign-in settings changed')).toBe(2);
      expect(b.close).toHaveBeenCalledWith(1012, 'Sign-in settings changed');
    });
  });

  describe('isSameOriginUpgrade', () => {
    it('allows a client that sends no Origin, such as a script', () => {
      expect(isSameOriginUpgrade(upgrade({ host: '192.168.1.5:3000' }))).toBe(true);
    });

    it('allows the page the server itself served', () => {
      expect(isSameOriginUpgrade(upgrade({ host: '192.168.1.5:3000', origin: 'http://192.168.1.5:3000' }))).toBe(true);
      expect(isSameOriginUpgrade(upgrade({ host: 'ark.example.com', origin: 'https://ark.example.com' }))).toBe(true);
      expect(isSameOriginUpgrade(upgrade({ host: 'Ark.Example.com:443', origin: 'https://ark.example.com' }))).toBe(true);
    });

    it('refuses a page from another site', () => {
      expect(isSameOriginUpgrade(upgrade({ host: '192.168.1.5:3000', origin: 'https://evil.example' }))).toBe(false);
      expect(isSameOriginUpgrade(upgrade({ host: '192.168.1.5:3000', origin: 'http://192.168.1.5:8080' }))).toBe(false);
      expect(isSameOriginUpgrade(upgrade({ host: '192.168.1.5:3000', origin: 'null' }))).toBe(false);
      expect(isSameOriginUpgrade(upgrade({ origin: 'http://192.168.1.5:3000' }))).toBe(false);
    });

    it('accepts the forwarded host from a reverse proxy that rewrites Host', () => {
      expect(isSameOriginUpgrade(upgrade({
        host: '127.0.0.1:3000', origin: 'https://ark.example.com', 'x-forwarded-host': 'ark.example.com, proxy.internal'
      }))).toBe(true);
    });
  });

  describe('attachWebSocketServer', () => {
    // Jest's own worker may be talking to its parent over process.send, so it is put back after.
    const originalSend = process.send;
    let wss: EventEmitter;
    let send: jest.Mock;

    beforeEach(() => {
      wss = new EventEmitter();
      MockedWebSocketServer.mockImplementation(() => wss as never);
      send = jest.fn();
      process.send = send;
    });

    afterEach(() => {
      process.send = originalSend;
      jest.useRealTimers();
    });

    function connect(identity: SocketIdentity | null, headers: Record<string, string> = {}) {
      service.resolveSocketUser = identity ? () => identity : null;
      service.attachWebSocketServer({} as HttpServer);
      const ws = socket();
      wss.emit('connection', ws, upgrade(headers));
      return ws;
    }

    it('refuses cross-origin upgrades', () => {
      service.attachWebSocketServer({} as HttpServer);

      const { verifyClient } = MockedWebSocketServer.mock.calls[0][0] as { verifyClient: (info: { req: IncomingMessage }) => boolean };
      expect(MockedWebSocketServer).toHaveBeenCalledWith(expect.objectContaining({ path: '/ws' }));
      expect(verifyClient({ req: upgrade({ host: 'h:3000', origin: 'https://evil.example' }) })).toBe(false);
      expect(verifyClient({ req: upgrade({ host: 'h:3000', origin: 'http://h:3000' }) })).toBe(true);
    });

    it('warns once for each refused origin and host, so a proxy that drops Host shows up in the log', () => {
      service.attachWebSocketServer({} as HttpServer);
      const { verifyClient } = MockedWebSocketServer.mock.calls[0][0] as { verifyClient: (info: { req: IncomingMessage }) => boolean };

      verifyClient({ req: upgrade({ host: '127.0.0.1:3000', origin: 'https://ark.example.com' }) });
      verifyClient({ req: upgrade({ host: '127.0.0.1:3000', origin: 'https://ark.example.com' }) });
      verifyClient({ req: upgrade({ host: '127.0.0.1:3000', origin: 'https://evil.example' }) });
      verifyClient({ req: upgrade({ host: 'h:3000', origin: 'http://h:3000' }) });

      expect(console.warn).toHaveBeenCalledTimes(2);
      expect(jest.mocked(console.warn).mock.calls[0][0]).toMatch(/^\[messaging\] .*"https:\/\/ark\.example\.com".*"127\.0\.0\.1:3000"/);
      expect(jest.mocked(console.warn).mock.calls[1][0]).toContain('"https://evil.example"');
    });

    it('closes idle sockets whose session has ended, once a minute', () => {
      jest.useFakeTimers();
      service.isSessionLive = token => token !== 'ended';
      const live = connect({ user: null, authEnabled: true, allowed: true, sessionToken: 'live' });
      const ended = connect({ user: null, authEnabled: true, allowed: true, sessionToken: 'ended' });
      const open = connect({ user: null, authEnabled: false, allowed: true });
      Object.assign(wss, { clients: new Set([live, ended, open]) });

      jest.advanceTimersByTime(59_999);
      expect(ended.close).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(ended.close).toHaveBeenCalledTimes(1);
      expect(ended.close).toHaveBeenCalledWith(4401, 'Session ended');
      expect(live.close).not.toHaveBeenCalled();
      expect(open.close).not.toHaveBeenCalled();
    });

    it('stops sweeping once the WebSocket server closes', () => {
      jest.useFakeTimers();
      service.attachWebSocketServer({} as HttpServer);
      expect(jest.getTimerCount()).toBe(1);

      wss.emit('close');

      expect(jest.getTimerCount()).toBe(0);
    });

    it('logs a server error instead of crashing the web server', () => {
      // ws re-emits the HTTP server's errors, EADDRINUSE included, on the WebSocketServer.
      service.attachWebSocketServer({} as HttpServer);

      expect(() => wss.emit('error', new Error('listen EADDRINUSE'))).not.toThrow();
      expect(console.error).toHaveBeenCalledWith('[messaging] WebSocket server error:', 'listen EADDRINUSE');
    });

    it('welcomes a signed-in client and relays its messages with its identity', () => {
      const user = { id: 'u1', username: 'viewer1', displayName: 'Viewer', roleId: 'viewer', roleName: '', permissions: [], active: true };
      const ws = connect({ user, authEnabled: true, allowed: true });

      ws.emit('message', Buffer.from(JSON.stringify({ channel: 'get-users', payload: { requestId: 'r1' } })));

      const welcome = JSON.parse(ws.send.mock.calls[0][0]);
      expect(welcome).toEqual({ channel: 'welcome', cid: expect.any(String) });
      expect(send).toHaveBeenCalledWith({
        type: 'messaging-event', channel: 'get-users', payload: { requestId: 'r1' }, cid: welcome.cid, user, authEnabled: true
      });
    });

    it('stamps the session token on the socket', () => {
      const ws = connect({ user: null, authEnabled: true, allowed: true, sessionToken: 'tok' });

      expect(ws._sessionToken).toBe('tok');
    });

    it('closes a socket whose session has ended instead of relaying its message', () => {
      service.isSessionLive = token => token !== 'ended';
      const live = connect({ user: null, authEnabled: true, allowed: true, sessionToken: 'live' });
      const ended = connect({ user: null, authEnabled: true, allowed: true, sessionToken: 'ended' });

      live.emit('message', Buffer.from(JSON.stringify({ channel: 'get-users', payload: {} })));
      ended.emit('message', Buffer.from(JSON.stringify({ channel: 'get-users', payload: {} })));

      expect(send).toHaveBeenCalledTimes(1);
      expect(ended.close).toHaveBeenCalledWith(4401, 'Session ended');
      expect(live.close).not.toHaveBeenCalled();
    });

    it('closes a connection that has no session', () => {
      const ws = connect({ user: null, authEnabled: true, allowed: false });

      expect(ws.close).toHaveBeenCalledWith(4401, 'Unauthorized');
      expect(ws.listenerCount('message')).toBe(0);
    });

    it('closes the connection when nothing can say who is on the other end', () => {
      const ws = connect(null);

      expect(ws.close).toHaveBeenCalledWith(4401, 'Unauthorized');
    });

    it('ignores messages that are not JSON or have no channel', () => {
      const ws = connect({ user: null, authEnabled: false, allowed: true });

      ws.emit('message', Buffer.from('not json'));
      ws.emit('message', Buffer.from(JSON.stringify({ payload: {} })));

      expect(send).not.toHaveBeenCalled();
    });

    it('survives a socket error', () => {
      const ws = connect({ user: null, authEnabled: false, allowed: true });

      expect(() => ws.emit('error', new Error('ECONNRESET'))).not.toThrow();
    });
  });
});
