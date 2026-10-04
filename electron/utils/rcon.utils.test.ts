import { EventEmitter } from 'events';
import {
  DEFAULT_RCON_COMMAND_TIMEOUT_MS,
  RconCommandNotSentError,
  cleanupAllRconConnections,
  connectRcon,
  disconnectRcon,
  getRconPassword,
  isRconConnected,
  isRconConnecting,
  sendRconCommand
} from './rcon.utils';

class FakeRcon extends EventEmitter {
  connect = jest.fn();
  disconnect = jest.fn();
  send = jest.fn();
  _tcpSocket = { destroy: jest.fn() };

  constructor(public host: string, public port: number, public password: string) {
    super();
  }
}

jest.mock('rcon', () => jest.fn());

const RconMock = jest.requireMock('rcon') as jest.Mock;
let clients: FakeRcon[];

function latest(): FakeRcon {
  return clients[clients.length - 1];
}

function refused(): NodeJS.ErrnoException {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:27020'), { code: 'ECONNREFUSED' });
}

function connect(instanceId = 'a1', config: Record<string, unknown> = { rconPort: 27020, rconPassword: 'pw' }) {
  const onStatus = jest.fn();
  connectRcon(instanceId, config, onStatus);
  return onStatus;
}

function connectNow(instanceId = 'a1'): FakeRcon {
  connect(instanceId);
  const client = latest();
  client.emit('auth');
  return client;
}

// Lets queued commands move along the promise chain.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function expectDestroyed(client: FakeRcon) {
  expect(client.disconnect).toHaveBeenCalled();
  expect(client._tcpSocket.destroy).toHaveBeenCalled();
  // A late socket error must still have a listener, or it would throw in the main process.
  expect(client.listenerCount('error')).toBe(1);
  expect(() => client.emit('error', new Error('late'))).not.toThrow();
}

describe('rcon.utils', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    clients = [];
    RconMock.mockImplementation((host: string, port: number, password: string) => {
      const client = new FakeRcon(host, port, password);
      clients.push(client);
      return client;
    });
  });

  afterEach(() => {
    cleanupAllRconConnections();
    jest.useRealTimers();
  });

  describe('connectRcon', () => {
    it('connects to the IPv4 loopback with the admin password', () => {
      connect('a1', { rconPort: '27021', serverAdminPassword: 'admin', rconPassword: 'legacy' });

      expect(RconMock).toHaveBeenCalledWith('127.0.0.1', 27021, 'admin');
      expect(latest().connect).toHaveBeenCalled();
    });

    it('defaults the port and falls back to the legacy RCON password', () => {
      connect('a1', { rconPassword: 'legacy' });

      expect(RconMock).toHaveBeenCalledWith('127.0.0.1', 27020, 'legacy');
    });

    it('reports success once the server accepts the password', () => {
      const onStatus = connect();

      latest().emit('auth');

      expect(onStatus).toHaveBeenCalledWith(true);
      expect(isRconConnected('a1')).toBe(true);
      expect(isRconConnecting('a1')).toBe(false);
    });

    it('answers straight away when already connected', () => {
      connectNow();

      const onStatus = connect();

      expect(onStatus).toHaveBeenCalledWith(true);
      expect(clients).toHaveLength(1);
    });

    it('destroys a failed client and retries after 3 seconds', () => {
      connect();
      const first = latest();

      first.emit('error', refused());

      expectDestroyed(first);
      expect(clients).toHaveLength(1);
      jest.advanceTimersByTime(3000);
      expect(clients).toHaveLength(2);
    });

    it('retries once when a failed attempt reports both an error and an end', () => {
      connect();

      latest().emit('error', refused());
      latest().emit('end');
      jest.advanceTimersByTime(3000);

      expect(clients).toHaveLength(2);
    });

    it('gives up after 30 attempts', () => {
      const onStatus = connect();

      for (let attempt = 1; attempt <= 30; attempt++) {
        latest().emit('error', refused());
        jest.advanceTimersByTime(3000);
      }

      expect(clients).toHaveLength(30);
      expect(onStatus).toHaveBeenCalledWith(false);
      expect(isRconConnecting('a1')).toBe(false);
      clients.forEach(expectDestroyed);
    });

    it('stops at a rejected password instead of retrying', () => {
      const onStatus = connect();

      latest().emit('error', new Error('Authentication failed'));
      jest.advanceTimersByTime(30000);

      expect(onStatus).toHaveBeenCalledWith(false);
      expect(clients).toHaveLength(1);
      expectDestroyed(clients[0]);
    });

    it('lets a second request share the running attempt and its result', () => {
      const first = connect();
      latest().emit('error', refused());

      const second = connect();
      jest.advanceTimersByTime(3000);
      latest().emit('auth');

      expect(clients).toHaveLength(2);
      expect(first).toHaveBeenCalledWith(true);
      expect(second).toHaveBeenCalledWith(true);
    });

    // net throws ERR_SOCKET_BAD_PORT synchronously, which used to leave a registered loop that
    // never answered.
    it.each(['abc', 99999])('answers not connected for an RCON port of %p without starting a loop', rconPort => {
      const onStatus = connect('a1', { rconPort, rconPassword: 'pw' });

      expect(onStatus).toHaveBeenCalledWith(false);
      expect(RconMock).not.toHaveBeenCalled();
      expect(isRconConnecting('a1')).toBe(false);
    });

    it('treats a connect that throws as a failed attempt', () => {
      RconMock.mockImplementationOnce((host: string, port: number, password: string) => {
        const client = new FakeRcon(host, port, password);
        client.connect.mockImplementation(() => { throw new Error('connect EINVAL'); });
        clients.push(client);
        return client;
      });
      connect();

      expectDestroyed(clients[0]);
      jest.advanceTimersByTime(3000);
      latest().emit('auth');

      expect(isRconConnected('a1')).toBe(true);
    });

    it('never logs the password or its length', () => {
      connect('a1', { rconPort: 27020, serverAdminPassword: 'hunter2' });
      latest().emit('error', refused());

      const logged = [console.log, console.warn, console.error]
        .flatMap(fn => (fn as jest.Mock).mock.calls.flat())
        .map(String)
        .join(' ');
      expect(logged).not.toMatch(/hunter2|length/i);
    });
  });

  describe('disconnectRcon', () => {
    it('cancels a pending retry and answers its callers', () => {
      const onStatus = connect();
      latest().emit('error', refused());

      disconnectRcon('a1');
      jest.advanceTimersByTime(60000);

      expect(clients).toHaveLength(1);
      expect(onStatus).toHaveBeenCalledWith(false);
      expect(isRconConnecting('a1')).toBe(false);
    });

    it('drops an attempt in flight so a late success cannot reconnect', () => {
      connect();
      const inFlight = latest();

      disconnectRcon('a1');
      inFlight.emit('auth');

      expectDestroyed(inFlight);
      expect(isRconConnected('a1')).toBe(false);
    });

    it('closes a connected client', () => {
      const client = connectNow();

      disconnectRcon('a1');

      expectDestroyed(client);
      expect(isRconConnected('a1')).toBe(false);
    });

    it('lets a new connection start afterwards', () => {
      connect();
      disconnectRcon('a1');

      connect();

      expect(clients).toHaveLength(2);
    });
  });

  describe('connected client', () => {
    it('is dropped when the server closes the connection', () => {
      const client = connectNow();

      client.emit('end');

      expect(isRconConnected('a1')).toBe(false);
      expectDestroyed(client);
    });

    it('is dropped on a socket error', () => {
      const client = connectNow();

      client.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));

      expect(isRconConnected('a1')).toBe(false);
    });
  });

  describe('sendRconCommand', () => {
    it('sends the command and resolves with the response', async () => {
      const client = connectNow();

      const pending = sendRconCommand('a1', 'ListPlayers');
      await flushMicrotasks();
      client.emit('response', 'No Players Connected');

      await expect(pending).resolves.toBe('No Players Connected');
      expect(client.send).toHaveBeenCalledWith('ListPlayers');
    });

    it('rejects when not connected', async () => {
      await expect(sendRconCommand('a1', 'ListPlayers')).rejects.toThrow('RCON not connected');
    });

    // The package tags every packet with the same id, so two commands in flight at once used to
    // receive each other's responses.
    it('gives concurrent commands their own responses', async () => {
      const client = connectNow();

      const players = sendRconCommand('a1', 'ListPlayers');
      const broadcast = sendRconCommand('a1', 'Broadcast hi');
      await flushMicrotasks();

      expect(client.send.mock.calls).toEqual([['ListPlayers']]);
      client.emit('response', '1. Alice, 123');
      await expect(players).resolves.toBe('1. Alice, 123');

      await flushMicrotasks();
      expect(client.send.mock.calls).toEqual([['ListPlayers'], ['Broadcast hi']]);
      client.emit('response', 'Server received, But no response!!');
      await expect(broadcast).resolves.toBe('Server received, But no response!!');
    });

    it('drops a client that stops answering, so polling reconnects', async () => {
      const client = connectNow();

      const pending = sendRconCommand('a1', 'DoExit', 1000);
      const assertion = expect(pending).rejects.toThrow('RCON command timed out after 1000ms');
      await flushMicrotasks();
      jest.advanceTimersByTime(1000);
      await assertion;

      expect(isRconConnected('a1')).toBe(false);
      expectDestroyed(client);
    });

    it('fails the commands queued behind a hung one without sending them', async () => {
      const client = connectNow();

      const hung = sendRconCommand('a1', 'SaveWorld', 5000);
      const queued = sendRconCommand('a1', 'ListPlayers', 5000);
      const hungFails = expect(hung).rejects.toThrow('timed out');
      const queuedFails = expect(queued).rejects.toThrow();
      await flushMicrotasks();
      jest.advanceTimersByTime(5000);
      await hungFails;
      await queuedFails;

      expect(client.send.mock.calls).toEqual([['SaveWorld']]);
    });

    it('counts time spent queued against the timeout', async () => {
      const client = connectNow();

      const first = sendRconCommand('a1', 'SaveWorld', 10000);
      const second = sendRconCommand('a1', 'ListPlayers', 2000);
      const secondFails = expect(second).rejects.toThrow('RCON command timed out after 2000ms');
      await flushMicrotasks();
      jest.advanceTimersByTime(2000);
      await secondFails;

      client.emit('response', 'World Saved');
      await expect(first).resolves.toBe('World Saved');
      expect(client.send.mock.calls).toEqual([['SaveWorld']]);
    });

    // A shutdown typed in the console marks the server stopping; only a command that provably never
    // went out may undo that.
    describe('tells a command that never went out from one that did', () => {
      it('when there was no connection', async () => {
        await expect(sendRconCommand('a1', 'DoExit')).rejects.toBeInstanceOf(RconCommandNotSentError);
      });

      it('when it timed out still queued behind another command', async () => {
        connectNow();

        void sendRconCommand('a1', 'SaveWorld', 10000).catch(() => undefined);
        const queued = sendRconCommand('a1', 'DoExit', 2000);
        const queuedFails = expect(queued).rejects.toBeInstanceOf(RconCommandNotSentError);
        await flushMicrotasks();
        jest.advanceTimersByTime(2000);
        await queuedFails;
      });

      it('but not when it timed out waiting for the answer', async () => {
        connectNow();

        const pending = sendRconCommand('a1', 'DoExit', 1000);
        const settled = pending.catch((error: unknown) => error);
        await flushMicrotasks();
        jest.advanceTimersByTime(1000);

        const error = await settled;
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(RconCommandNotSentError);
      });
    });

    it('rejects when the connection closes before the response', async () => {
      const client = connectNow();

      const pending = sendRconCommand('a1', 'SaveWorld');
      await flushMicrotasks();
      client.emit('end');

      await expect(pending).rejects.toThrow('RCON connection closed before response');
    });

    it('rejects when the client is disconnected mid-command', async () => {
      connectNow();

      const pending = sendRconCommand('a1', 'SaveWorld');
      await flushMicrotasks();
      disconnectRcon('a1');

      await expect(pending).rejects.toThrow('RCON connection closed before response');
    });

    it('waits 30 seconds by default', () => {
      expect(DEFAULT_RCON_COMMAND_TIMEOUT_MS).toBe(30000);
    });
  });

  describe('cleanupAllRconConnections', () => {
    it('closes every client and cancels every retry', () => {
      const connected = connectNow('a1');
      connect('b2');
      latest().emit('error', refused());

      cleanupAllRconConnections();
      jest.advanceTimersByTime(60000);

      expectDestroyed(connected);
      expect(isRconConnected('a1')).toBe(false);
      expect(isRconConnecting('b2')).toBe(false);
      expect(clients).toHaveLength(2);
    });
  });

  describe('getRconPassword', () => {
    it('prefers the admin password, which is what ARK authenticates RCON with', () => {
      expect(getRconPassword({ serverAdminPassword: 'admin', rconPassword: 'legacy' })).toBe('admin');
      expect(getRconPassword({ rconPassword: 12345 })).toBe('12345');
      expect(getRconPassword({})).toBe('');
    });
  });
});
