import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { WebSocketService, socketUrl } from './web-socket.service';
import { IpcService } from './ipc.service';
import { BACKUP_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS } from './messaging/messaging.service';

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  static get latest(): FakeSocket {
    return FakeSocket.instances[FakeSocket.instances.length - 1];
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** The server's greeting to a socket it accepted; a refused socket never gets one. */
  welcome(): void {
    this.receive({ channel: 'welcome', cid: 'c1' });
  }

  /** The socket opens and the server accepts the session. */
  accept(): void {
    this.open();
    this.welcome();
  }

  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }
}

describe('socketUrl', () => {
  it('uses the page host, port included', () => {
    expect(socketUrl({ protocol: 'http:', host: '192.168.1.20:3000' })).toBe('ws://192.168.1.20:3000/ws');
  });

  it('uses wss behind https, with no port on 443', () => {
    expect(socketUrl({ protocol: 'https:', host: 'ark.example.com' })).toBe('wss://ark.example.com/ws');
  });

  it('keeps a port-less http host port-less', () => {
    expect(socketUrl({ protocol: 'http:', host: 'ark.lan' })).toBe('ws://ark.lan/ws');
  });
});

describe('WebSocketService', () => {
  let service: WebSocketService;
  let originalWebSocket: typeof WebSocket;
  const sent = (socket: FakeSocket) => socket.sent.map(data => JSON.parse(data));

  const create = (isElectron = false) => new WebSocketService({ isElectron } as IpcService);

  beforeEach(() => {
    FakeSocket.instances = [];
    originalWebSocket = window.WebSocket;
    (window as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
    spyOn(Math, 'random').and.returnValue(1);
  });

  afterEach(() => {
    service?.ngOnDestroy();
    window.WebSocket = originalWebSocket;
  });

  it('connects to the page origin in the web UI', () => {
    service = create();
    expect(FakeSocket.instances.length).toBe(1);
    expect(FakeSocket.latest.url).toBe(socketUrl(window.location));
  });

  it('never opens a socket in the desktop app', () => {
    service = create(true);
    service.sendMessage('chan', {});
    expect(FakeSocket.instances.length).toBe(0);
  });

  it('reports the connection state', () => {
    service = create();
    const states: boolean[] = [];
    service.connected$.subscribe(state => states.push(state));

    FakeSocket.latest.accept();
    FakeSocket.latest.drop();

    expect(states).toEqual([false, true, false]);
  });

  describe('between the socket opening and the server accepting the session', () => {
    let states: boolean[];

    beforeEach(() => {
      service = create();
      states = [];
      service.connected$.subscribe(state => states.push(state));
    });

    it('is not up yet, since the server closes a socket it refuses only after opening it', () => {
      FakeSocket.latest.open();
      expect(states).toEqual([false]);
    });

    it('is up once the server welcomes the socket', () => {
      FakeSocket.latest.open();
      FakeSocket.latest.welcome();
      expect(states).toEqual([false, true]);
    });

    it('holds messages instead of writing them to the open socket, and sends them in order on the welcome', () => {
      service.sendMessage('before-open', { n: 1 });
      FakeSocket.latest.open();
      service.sendMessage('after-open', { n: 2 });
      expect(FakeSocket.latest.sent).toEqual([]);

      FakeSocket.latest.welcome();

      expect(sent(FakeSocket.latest).map(m => m.channel)).toEqual(['before-open', 'after-open']);
    });

    it('flushes held messages before telling anyone the socket is up', () => {
      service.sendMessage('queued', {});
      service.connected$.subscribe(connected => {
        if (connected) service.sendMessage('on-connect', {});
      });
      FakeSocket.latest.open();

      FakeSocket.latest.welcome();

      expect(sent(FakeSocket.latest).map(m => m.channel)).toEqual(['queued', 'on-connect']);
    });

    it('is refused without ever being up when the server closes it with 4401, and the held messages are gone', fakeAsync(() => {
      let unauthorized = 0;
      service.unauthorized$.subscribe(() => unauthorized++);
      service.sendMessage('queued', {});
      FakeSocket.latest.open();
      service.sendMessage('after-open', {});

      FakeSocket.latest.receive({ channel: 'unauthorized', error: 'Sign in to use this connection.' });
      FakeSocket.latest.drop(4401);
      tick(60_000);

      expect(states).toEqual([false, false]);
      expect(unauthorized).toBe(1);
      expect(FakeSocket.latest.sent).toEqual([]);
      expect(FakeSocket.instances.length).toBe(1);

      service.reconnectNow();
      FakeSocket.latest.accept();
      expect(FakeSocket.instances.length).toBe(2);
      expect(FakeSocket.latest.sent).toEqual([]);
      expect(states).toEqual([false, false, true]);
    }));

    it('keeps the back-off going, since the connection has not worked yet', fakeAsync(() => {
      for (let attempt = 0; attempt < 5; attempt++) {
        FakeSocket.latest.drop();
        tick(30_000);
      }
      FakeSocket.latest.open();
      FakeSocket.latest.drop();
      tick(1000);
      expect(FakeSocket.instances.length).toBe(6);
      service.ngOnDestroy();
    }));

    it('ignores a second welcome on the same socket', () => {
      FakeSocket.latest.accept();
      service.sendMessage('after', {});
      FakeSocket.latest.welcome();

      expect(states).toEqual([false, true]);
      expect(sent(FakeSocket.latest).length).toBe(1);
    });

    it('does not count a socket that is not the current one', fakeAsync(() => {
      const first = FakeSocket.latest;
      first.drop();
      tick(1000);

      first.welcome();

      expect(states).not.toContain(true);
    }));
  });

  it('delivers messages to the channel they name and ignores the rest', () => {
    service = create();
    const received: unknown[] = [];
    service.receiveMessage('mychan').subscribe(data => received.push(data));

    FakeSocket.latest.receive({ channel: 'mychan', data: 'payload' });
    FakeSocket.latest.receive({ channel: 'other', data: 'nope' });
    expect(() => FakeSocket.latest.receive('{invalid json}')).not.toThrow();

    expect(received).toEqual(['payload']);
  });

  it('sends right away when open', () => {
    service = create();
    FakeSocket.latest.accept();
    service.sendMessage('test', { foo: 'bar' });
    expect(sent(FakeSocket.latest)).toEqual([{ channel: 'test', payload: { foo: 'bar' } }]);
  });

  it('holds messages sent while connecting and sends them in order once open', () => {
    service = create();
    service.sendMessage('first', { n: 1 });
    service.sendMessage('second', { n: 2 });
    expect(FakeSocket.latest.sent).toEqual([]);

    FakeSocket.latest.accept();

    expect(sent(FakeSocket.latest)).toEqual([
      { channel: 'first', payload: { n: 1 } },
      { channel: 'second', payload: { n: 2 } }
    ]);
  });

  it('flushes held messages before telling anyone the socket is up', () => {
    service = create();
    service.sendMessage('queued', {});
    service.connected$.subscribe(connected => {
      if (connected) service.sendMessage('on-connect', {});
    });

    FakeSocket.latest.accept();

    expect(sent(FakeSocket.latest).map(m => m.channel)).toEqual(['queued', 'on-connect']);
  });

  it('holds a message sent while the socket is closing and sends it on the next connection', fakeAsync(() => {
    service = create();
    const closing = FakeSocket.latest;
    closing.accept();
    closing.readyState = FakeSocket.CLOSING;

    service.sendMessage('late', {});
    closing.drop();
    tick(1000);
    FakeSocket.latest.accept();

    expect(closing.sent).toEqual([]);
    expect(sent(FakeSocket.latest).map(m => m.channel)).toEqual(['late']);
  }));

  it('does not replay messages whose callers have already timed out, and says so', fakeAsync(() => {
    spyOn(console, 'warn');
    service = create();
    FakeSocket.latest.drop();
    service.sendMessage('stale', {});
    tick(DEFAULT_REQUEST_TIMEOUT_MS + 1);
    service.sendMessage('fresh', {});

    FakeSocket.latest.accept();

    expect(sent(FakeSocket.latest).map(m => m.channel)).toEqual(['fresh']);
    expect(console.warn).toHaveBeenCalledWith('[web-socket] Dropped 1 queued message(s) whose callers had stopped waiting');
  }));

  it('keeps a message whose caller waits longer than the default', fakeAsync(() => {
    spyOn(console, 'warn');
    service = create();
    FakeSocket.latest.drop();
    service.sendMessage('create-backup', {}, BACKUP_TIMEOUT_MS);
    service.sendMessage('get-server-instances', {});
    tick(DEFAULT_REQUEST_TIMEOUT_MS + 1);

    FakeSocket.latest.accept();

    expect(sent(FakeSocket.latest).map(m => m.channel)).toEqual(['create-backup']);
  }));

  it('holds at most 100 messages, dropping the oldest', () => {
    spyOn(console, 'warn');
    service = create();
    for (let i = 0; i < 101; i++) service.sendMessage('chan', { i });

    FakeSocket.latest.accept();

    const payloads = sent(FakeSocket.latest).map(m => m.payload.i);
    expect(payloads.length).toBe(100);
    expect(payloads[0]).toBe(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('keeps reconnecting, backing off to at most 30 seconds', fakeAsync(() => {
    service = create();
    for (let attempt = 0; attempt < 30; attempt++) {
      FakeSocket.latest.drop();
      tick(30_000);
    }
    expect(FakeSocket.instances.length).toBe(31);

    FakeSocket.latest.drop();
    tick(29_999);
    expect(FakeSocket.instances.length).toBe(31);
    tick(1);
    expect(FakeSocket.instances.length).toBe(32);
  }));

  it('spreads reconnects out with jitter', fakeAsync(() => {
    (Math.random as jasmine.Spy).and.returnValue(0);
    service = create();
    FakeSocket.latest.drop();
    tick(499);
    expect(FakeSocket.instances.length).toBe(1);
    tick(1);
    expect(FakeSocket.instances.length).toBe(2);
  }));

  it('resets the back-off after a successful connection', fakeAsync(() => {
    service = create();
    for (let attempt = 0; attempt < 5; attempt++) {
      FakeSocket.latest.drop();
      tick(30_000);
    }
    FakeSocket.latest.accept();
    FakeSocket.latest.drop();
    tick(1000);
    expect(FakeSocket.instances.length).toBe(7);
  }));

  it('reconnects at once when the browser comes back online', fakeAsync(() => {
    service = create();
    for (let attempt = 0; attempt < 10; attempt++) {
      FakeSocket.latest.drop();
      tick(30_000);
    }
    FakeSocket.latest.drop();
    const before = FakeSocket.instances.length;

    window.dispatchEvent(new Event('online'));

    expect(FakeSocket.instances.length).toBe(before + 1);
    FakeSocket.latest.accept();
    tick(30_000);
    expect(FakeSocket.instances.length).toBe(before + 1);
  }));

  it('sends a message held while down once the scheduled reconnect opens', fakeAsync(() => {
    service = create();
    FakeSocket.latest.drop();
    service.sendMessage('chan', {});
    tick(1000);
    expect(FakeSocket.instances.length).toBe(2);
    FakeSocket.latest.accept();
    expect(sent(FakeSocket.latest)).toEqual([{ channel: 'chan', payload: {} }]);
    tick(30_000);
    expect(FakeSocket.instances.length).toBe(2);
  }));

  it('leaves reconnecting to the back-off however many messages are sent while down', fakeAsync(() => {
    service = create();
    for (let attempt = 0; attempt < 6; attempt++) {
      FakeSocket.latest.drop();
      tick(30_000);
    }
    FakeSocket.latest.drop();
    const before = FakeSocket.instances.length;

    for (let i = 0; i < 20; i++) service.sendMessage('poll', { i });
    tick(29_999);
    expect(FakeSocket.instances.length).toBe(before);

    tick(1);
    expect(FakeSocket.instances.length).toBe(before + 1);
    FakeSocket.latest.accept();
    expect(sent(FakeSocket.latest).length).toBe(20);
  }));

  it('does not open a second socket for a message sent while the first is still connecting', () => {
    service = create();
    service.sendMessage('chan', {});
    service.sendMessage('chan', {});
    expect(FakeSocket.instances.length).toBe(1);
  });

  describe('when the server refuses the session (4401)', () => {
    let unauthorized: number;

    beforeEach(() => {
      service = create();
      unauthorized = 0;
      service.unauthorized$.subscribe(() => unauthorized++);
      service.sendMessage('queued-before-refusal', {});
      FakeSocket.latest.drop(4401);
    });

    it('says so and stops trying', fakeAsync(() => {
      expect(unauthorized).toBe(1);
      tick(60_000);
      expect(FakeSocket.instances.length).toBe(1);
    }));

    it('does not reconnect for a send or for coming back online', fakeAsync(() => {
      service.sendMessage('chan', {});
      service.receiveMessage('chan').subscribe();
      window.dispatchEvent(new Event('online'));
      tick(60_000);
      expect(FakeSocket.instances.length).toBe(1);
    }));

    it('connects again after signing in, without the stale messages', () => {
      service.sendMessage('while-refused', {});
      service.reconnectNow();
      service.sendMessage('after-sign-in', {});

      FakeSocket.latest.accept();

      expect(FakeSocket.instances.length).toBe(2);
      expect(sent(FakeSocket.latest).map(m => m.channel)).toEqual(['after-sign-in']);
    });
  });

  describe('when this client signs out', () => {
    let unauthorized: number;
    let states: boolean[];

    beforeEach(() => {
      service = create();
      FakeSocket.latest.accept();
      unauthorized = 0;
      states = [];
      service.unauthorized$.subscribe(() => unauthorized++);
      service.connected$.subscribe(connected => states.push(connected));
    });

    it('closes the socket, says the session is over and stays closed', fakeAsync(() => {
      const socket = FakeSocket.latest;
      service.endSession();
      service.sendMessage('after-sign-out', {});
      window.dispatchEvent(new Event('online'));
      tick(60_000);

      expect(socket.readyState).toBe(FakeSocket.CLOSED);
      expect(states).toEqual([true, false]);
      expect(unauthorized).toBe(1);
      expect(FakeSocket.instances.length).toBe(1);
    }));

    it('connects again after the next sign-in, without what was sent while signed out', () => {
      service.endSession();
      service.sendMessage('while-signed-out', {});
      service.reconnectNow();
      FakeSocket.latest.accept();

      expect(FakeSocket.instances.length).toBe(2);
      expect(sent(FakeSocket.latest)).toEqual([]);
      expect(states).toEqual([true, false, true]);
    });
  });

  it('whenConnected resolves true once the server has accepted the session', fakeAsync(() => {
    service = create();
    let result: boolean | undefined;
    service.whenConnected(4000).then(connected => result = connected);

    FakeSocket.latest.open();
    flushMicrotasks();
    expect(result).toBeUndefined();

    FakeSocket.latest.welcome();
    flushMicrotasks();

    expect(result).toBeTrue();
  }));

  it('whenConnected resolves false after the timeout', fakeAsync(() => {
    service = create();
    let result: boolean | undefined;
    service.whenConnected(4000).then(connected => result = connected);

    tick(4000);

    expect(result).toBeFalse();
  }));
});
