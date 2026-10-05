import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NgForOf, NgIf } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { App } from './app';
import { MessagingService } from './core/services/messaging/messaging.service';
import { NotificationService } from './core/services/notification.service';
import { ServerInstanceService } from './core/services/server-instance.service';
import { IpcService } from './core/services/ipc.service';
import { ServerLifecycleService } from './core/services/server-lifecycle.service';
import { WebSocketService } from './core/services/web-socket.service';
import { ServerInstance } from './core/models/server-instance.model';
import type { ElectronListener } from './core/types/electron-api';
import { MockMessagingService } from '../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../test/mocks/mock-server-instance.service';
import { ModalComponent } from './components/modal/modal.component';

describe('App', () => {
  let ipc: { isElectron: boolean; on: jasmine.Spy; send: jasmine.Spy; invoke: jasmine.Spy };
  let ipcListeners: Map<string, ElectronListener>;
  let lifecycle: jasmine.SpyObj<ServerLifecycleService>;
  let connected$: BehaviorSubject<boolean>;
  let unauthorized$: Subject<void>;

  const running: ServerInstance[] = [{ id: 'a', name: 'Alpha', state: 'running' }];

  async function setUp(isElectron: boolean): Promise<void> {
    ipcListeners = new Map();
    ipc = {
      isElectron,
      on: jasmine.createSpy('on').and.callFake((channel: string, listener: ElectronListener) => {
        ipcListeners.set(channel, listener);
        return () => ipcListeners.delete(channel);
      }),
      send: jasmine.createSpy('send'),
      invoke: jasmine.createSpy('invoke').and.resolveTo(false)
    };
    lifecycle = jasmine.createSpyObj('ServerLifecycleService', ['runningServers', 'shutdownAllServers']);
    lifecycle.runningServers.and.returnValue([]);
    lifecycle.shutdownAllServers.and.resolveTo();
    connected$ = new BehaviorSubject(false);
    unauthorized$ = new Subject<void>();

    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: IpcService, useValue: ipc },
        { provide: ServerLifecycleService, useValue: lifecycle },
        {
          provide: WebSocketService,
          useValue: { connected$, unauthorized$, sendMessage: () => {}, receiveMessage: () => new Subject() }
        }
      ]
    });
    // The shell's children have their own specs; stub them so only App is under test.
    TestBed.overrideComponent(App, {
      set: { imports: [NgIf, NgForOf, RouterOutlet, ModalComponent], schemas: [NO_ERRORS_SCHEMA] }
    });
    await TestBed.compileComponents();
  }

  const createApp = () => {
    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.ngOnInit();
    return fixture;
  };

  describe('in the desktop app', () => {
    beforeEach(() => setUp(true));

    it('exits straight away when no server is running', () => {
      createApp();
      ipcListeners.get('app-close-request')!({});
      expect(ipc.send).toHaveBeenCalledWith('app-close-response', { action: 'exit' });
    });

    it('asks first when servers are running, listing them from the live roster', () => {
      lifecycle.runningServers.and.returnValue(running);
      const app = createApp().componentInstance;

      ipcListeners.get('app-close-request')!({});

      expect(app.showExitModal).toBeTrue();
      expect(app.runningServers).toEqual(running);
      expect(ipc.send).not.toHaveBeenCalled();
    });

    it('answers only after the servers have stopped', fakeAsync(() => {
      let finish!: () => void;
      lifecycle.shutdownAllServers.and.returnValue(new Promise<void>(resolve => finish = resolve));
      const app = createApp().componentInstance;
      app.showExitModal = true;

      app.onExitModalClose('shutdown');
      flushMicrotasks();
      expect(app.shuttingDown).toBeTrue();
      expect(ipc.send).not.toHaveBeenCalled();

      finish();
      flushMicrotasks();

      expect(ipc.send).toHaveBeenCalledWith('app-close-response', { action: 'shutdown' });
      expect(app.showExitModal).toBeFalse();
      expect(app.shuttingDown).toBeFalse();
    }));

    it('still answers when stopping the servers fails', fakeAsync(() => {
      spyOn(console, 'error');
      lifecycle.shutdownAllServers.and.rejectWith(new Error('boom'));
      const app = createApp().componentInstance;

      app.onExitModalClose('shutdown');
      flushMicrotasks();

      expect(ipc.send).toHaveBeenCalledWith('app-close-response', { action: 'shutdown' });
    }));

    it('ignores other choices while servers are stopping', fakeAsync(() => {
      lifecycle.shutdownAllServers.and.returnValue(new Promise<void>(() => {}));
      const app = createApp().componentInstance;

      app.onExitModalClose('shutdown');
      app.onExitModalClose('cancel');
      flushMicrotasks();

      expect(ipc.send).not.toHaveBeenCalled();
      expect(lifecycle.shutdownAllServers).toHaveBeenCalledTimes(1);
    }));

    // Main asks again if it hears nothing for a while. By then the stopping servers no longer
    // count as running, so answering would let main exit while they are still saving.
    it('ignores a repeated close request while its servers are stopping', fakeAsync(() => {
      lifecycle.runningServers.and.returnValue(running);
      lifecycle.shutdownAllServers.and.returnValue(new Promise<void>(() => {}));
      const app = createApp().componentInstance;
      ipcListeners.get('app-close-request')!({});
      app.onExitModalClose('shutdown');
      flushMicrotasks();

      lifecycle.runningServers.and.returnValue([]);
      ipcListeners.get('app-close-request')!({});

      expect(ipc.send).not.toHaveBeenCalled();
      expect(app.shuttingDown).toBeTrue();
    }));

    it('ignores a repeated close request while the question is still open', () => {
      lifecycle.runningServers.and.returnValue(running);
      const app = createApp().componentInstance;
      ipcListeners.get('app-close-request')!({});

      lifecycle.runningServers.and.returnValue([]);
      ipcListeners.get('app-close-request')!({});

      expect(ipc.send).not.toHaveBeenCalled();
      expect(app.showExitModal).toBeTrue();
      expect(app.runningServers).toEqual(running);
    });

    it('passes exit and cancel straight through', async () => {
      const app = createApp().componentInstance;
      app.showExitModal = true;
      await app.onExitModalClose('exit');
      expect(ipc.send).toHaveBeenCalledWith('app-close-response', { action: 'exit' });
      expect(app.showExitModal).toBeFalse();

      app.showExitModal = true;
      await app.onExitModalClose('cancel');
      expect(ipc.send).toHaveBeenCalledWith('app-close-response', { action: 'cancel' });
      expect(app.showExitModal).toBeFalse();
      expect(lifecycle.shutdownAllServers).not.toHaveBeenCalled();
    });

    it('stops listening for close requests on destroy', () => {
      const fixture = createApp();
      fixture.componentInstance.ngOnDestroy();
      expect(ipcListeners.has('app-close-request')).toBeFalse();
    });
  });

  describe('in the web UI', () => {
    beforeEach(() => setUp(false));

    it('does not listen for window close requests', () => {
      const app = createApp().componentInstance;
      expect(app.isElectron).toBeFalse();
      expect(ipc.on).not.toHaveBeenCalled();
    });

    it('shows "Connection Lost" when the first connection never comes', fakeAsync(() => {
      const app = createApp().componentInstance;
      tick(5000);
      expect(app.connecting).toBeFalse();
      expect(app.connectionLost).toBeTrue();
    }));

    it('tracks the connection once it has been up', fakeAsync(() => {
      const app = createApp().componentInstance;
      connected$.next(true);
      expect(app.connecting).toBeFalse();
      expect(app.connectionLost).toBeFalse();

      connected$.next(false);
      expect(app.connectionLost).toBeTrue();

      connected$.next(true);
      expect(app.connectionLost).toBeFalse();
      tick(5000);
      expect(app.connectionLost).toBeFalse();
    }));

    it('goes to the login page when the session is refused', fakeAsync(() => {
      const fixture = createApp();
      const navigate = spyOn(fixture.componentInstance['router'], 'navigate').and.resolveTo(true);
      unauthorized$.next();
      tick(5000);
      expect(navigate).toHaveBeenCalledWith(['/login']);
      expect(fixture.componentInstance.connectionLost).toBeFalse();
    }));

    it('should render main app content once connected', () => {
      const fixture = createApp();
      connected$.next(true);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('.sidebar-container')).toBeTruthy();
    });
  });

  describe('layout', () => {
    beforeEach(() => setUp(true));

    it('should handle onServerSelected and close mobile menu', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.isMobile = true;
      app.isMobileMenuOpen = true;
      app.onServerSelected({ id: '1', name: 'TestServer' });
      expect(app.selectedServer).toEqual({ id: '1', name: 'TestServer' });
      expect(app.isMobileMenuOpen).toBeFalse();
    });

    it('should toggle and close mobile menu', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.isMobileMenuOpen = false;
      app.toggleMobileMenu();
      expect(app.isMobileMenuOpen).toBeTrue();
      app.closeMobileMenu();
      expect(app.isMobileMenuOpen).toBeFalse();
    });

    it('closes the mobile menu when the window grows past the mobile width', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.isMobile = true;
      app.isMobileMenuOpen = true;
      spyOnProperty(window, 'innerWidth').and.returnValue(1200);
      window.dispatchEvent(new Event('resize'));
      expect(app.isMobile).toBeFalse();
      expect(app.isMobileMenuOpen).toBeFalse();
    });

    it('stops listening for resizes on destroy', () => {
      const app = TestBed.createComponent(App).componentInstance;
      spyOn(window, 'removeEventListener').and.callThrough();
      app.ngOnDestroy();
      expect(window.removeEventListener).toHaveBeenCalledWith('resize', jasmine.any(Function));
    });
  });
});
