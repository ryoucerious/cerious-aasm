import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import { AuthService } from './auth.service';
import { MessagingService } from './messaging/messaging.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';

describe('AuthService', () => {
  let messaging: jasmine.SpyObj<MessagingService>;
  let connected$: BehaviorSubject<boolean>;
  let channels: Record<string, Subject<unknown>>;
  let webSocket: { connected$: Observable<boolean>; reconnectNow: jasmine.Spy; whenConnected: jasmine.Spy; endSession: jasmine.Spy };
  let currentUser: unknown;

  const requests = (channel: string) => messaging.sendMessage.calls.allArgs().filter(([name]) => name === channel).length;
  const identityRequests = () => requests('get-current-user');

  function create(isElectron: boolean): AuthService {
    TestBed.configureTestingModule({
      providers: [
        { provide: MessagingService, useValue: messaging },
        { provide: WebSocketService, useValue: webSocket },
        { provide: IpcService, useValue: { isElectron } }
      ]
    });
    return TestBed.inject(AuthService);
  }

  function respond(status: number, body: unknown): jasmine.Spy {
    return spyOn(window, 'fetch').and.returnValue(Promise.resolve(new Response(JSON.stringify(body), { status })));
  }

  function latestName(service: AuthService): string {
    let name = '';
    service.displayName$.subscribe(value => name = value).unsubscribe();
    return name;
  }

  beforeEach(() => {
    connected$ = new BehaviorSubject(false);
    channels = {};
    currentUser = { username: 'ann', displayName: '' };
    webSocket = {
      connected$,
      reconnectNow: jasmine.createSpy('reconnectNow'),
      whenConnected: jasmine.createSpy('whenConnected').and.resolveTo(true),
      endSession: jasmine.createSpy('endSession')
    };
    messaging = jasmine.createSpyObj('MessagingService', ['sendMessage', 'receiveMessage']);
    messaging.receiveMessage.and.callFake(((channel: string) => channels[channel] ??= new Subject<unknown>()) as any);
    messaging.sendMessage.and.callFake(((channel: string) => {
      if (channel === 'get-current-user') {
        return of({ success: true, user: currentUser, isLocalDesktop: false, isAdmin: false, permissions: ['servers.view'], accountsInUse: true });
      }
      if (channel === 'get-global-config') return of({ authenticationEnabled: true, authenticationUsername: 'legacy' });
      return of({ success: true });
    }) as any);
  });

  it('asks who is signed in each time the web socket comes up', () => {
    const service = create(false);
    const before = identityRequests();

    connected$.next(true);
    connected$.next(false);
    connected$.next(true);

    expect(identityRequests()).toBe(before + 2);
    expect(service.identity.isAdmin).toBeFalse();
    expect(service.can('servers.view')).toBeTrue();
    expect(service.can('servers.delete')).toBeFalse();
  });

  it('asks once at startup in the desktop app', () => {
    create(true);
    expect(identityRequests()).toBe(1);
  });

  it('keeps the optimistic identity when the backend does not answer', () => {
    messaging.sendMessage.and.returnValue(of({ success: false }));
    const service = create(true);
    expect(service.identity.isAdmin).toBeTrue();
  });

  it('reports a mutation with no answer as a failure', async () => {
    const service = create(true);
    messaging.sendMessage.and.returnValue(of(null));
    await expectAsync(service.deleteUser('u1')).toBeResolvedTo({ success: false, error: 'No response from the server.' });
  });

  describe('the name it shows', () => {
    it('is the account display name, or its username', () => {
      currentUser = { username: 'ann', displayName: 'Ann B' };
      const service = create(false);
      connected$.next(true);
      expect(latestName(service)).toBe('Ann B');

      currentUser = { username: 'ann', displayName: '' };
      service.refresh();
      expect(latestName(service)).toBe('ann');
    });

    it('is the username of the login that predates accounts, for a web session without an account', () => {
      currentUser = null;
      const service = create(false);
      connected$.next(true);
      expect(requests('get-global-config')).toBe(1);
      expect(latestName(service)).toBe('legacy');

      channels['global-config'].next({ authenticationEnabled: false, authenticationUsername: 'legacy' });
      expect(latestName(service)).toBe('Admin');

      connected$.next(true);
      expect(requests('get-global-config')).toBe(1);
    });

    it('is Admin in the desktop app, which never signs in', () => {
      currentUser = null;
      const service = create(true);
      channels['global-config'].next({ authenticationEnabled: true, authenticationUsername: 'legacy' });
      expect(latestName(service)).toBe('Admin');
      expect(requests('get-global-config')).toBe(0);
    });
  });

  describe('signing in', () => {
    it('sends the password exactly as typed', async () => {
      const fetchSpy = respond(200, { success: true });
      const service = create(false);

      await service.login('ann', '  pass word  ');

      const init = fetchSpy.calls.mostRecent().args[1] as RequestInit;
      expect(fetchSpy.calls.mostRecent().args[0]).toBe('/api/login');
      expect(JSON.parse(String(init.body))).toEqual({ username: 'ann', password: '  pass word  ' });
    });

    it('reconnects under the new session, and knows who is signed in, before it resolves', async () => {
      respond(200, { success: true });
      webSocket.whenConnected.and.callFake(async () => {
        connected$.next(true);
        return true;
      });
      const service = create(false);
      const before = identityRequests();

      await expectAsync(service.login('ann', 'secret')).toBeResolvedTo({ success: true, status: 200 });

      expect(webSocket.reconnectNow).toHaveBeenCalled();
      expect(identityRequests()).toBe(before + 1);
      expect(service.currentUser).not.toBeNull();
    });

    it('passes on a refusal with its status and reason', async () => {
      respond(401, { success: false, error: 'Invalid credentials' });
      const service = create(false);

      await expectAsync(service.login('ann', 'wrong')).toBeResolvedTo({ success: false, status: 401, error: 'Invalid credentials' });
      expect(webSocket.reconnectNow).not.toHaveBeenCalled();
    });

    it('reports status 0 when the server cannot be reached', async () => {
      spyOn(window, 'fetch').and.returnValue(Promise.reject(new TypeError('Failed to fetch')));
      const service = create(false);

      await expectAsync(service.login('ann', 'secret')).toBeResolvedTo({ success: false, status: 0 });
    });
  });

  describe('signing out', () => {
    it('ends the session, closes the socket and forgets who was signed in', async () => {
      const fetchSpy = respond(200, { success: true });
      const service = create(false);
      connected$.next(true);
      expect(service.currentUser).not.toBeNull();

      await expectAsync(service.logout()).toBeResolvedTo(true);

      expect(fetchSpy).toHaveBeenCalledWith('/api/logout', jasmine.objectContaining({ method: 'POST' }));
      expect(webSocket.endSession).toHaveBeenCalled();
      expect(service.currentUser).toBeNull();
      expect(service.identity.isAdmin).toBeFalse();
      expect(service.identity.permissions).toEqual([]);
    });

    it('keeps the session when the server does not confirm', async () => {
      spyOn(console, 'error');
      respond(500, { success: false });
      const service = create(false);
      connected$.next(true);

      await expectAsync(service.logout()).toBeResolvedTo(false);

      expect(webSocket.endSession).not.toHaveBeenCalled();
      expect(service.currentUser).not.toBeNull();
    });
  });
});
