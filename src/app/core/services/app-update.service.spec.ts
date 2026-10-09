import { BehaviorSubject, Subject } from 'rxjs';
import { AppUpdateService, AppUpdateStatus } from './app-update.service';
import { MessagingService } from './messaging/messaging.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';

describe('AppUpdateService', () => {
  let messaging: jasmine.SpyObj<MessagingService>;
  let channels: Record<string, Subject<AppUpdateStatus>>;
  let connected$: BehaviorSubject<boolean>;

  const create = (isElectron = false) => new AppUpdateService(
    messaging,
    { connected$ } as unknown as WebSocketService,
    { isElectron } as IpcService
  );
  const statusRequests = () => messaging.sendNotification.calls.allArgs().filter(([channel]) => channel === 'get-app-update-status');

  beforeEach(() => {
    channels = {};
    connected$ = new BehaviorSubject(false);
    messaging = jasmine.createSpyObj('MessagingService', ['receiveMessage', 'sendNotification']);
    messaging.receiveMessage.and.callFake(((channel: string) => channels[channel] ??= new Subject<AppUpdateStatus>()) as any);
  });

  it('asks once at startup in the desktop app, which has no socket', () => {
    create(true);
    connected$.next(false);
    expect(statusRequests().length).toBe(1);
  });

  it('asks nothing in the web UI before the socket is up, since a refused session drops the request', () => {
    create(false);
    expect(statusRequests()).toEqual([]);
  });

  it('asks once when the socket comes up, and again on each reconnect', () => {
    create(false);

    connected$.next(true);
    expect(statusRequests().length).toBe(1);

    connected$.next(false);
    expect(statusRequests().length).toBe(1);

    connected$.next(true);
    expect(statusRequests().length).toBe(2);
  });

  it('keeps the latest status for a listener that comes late', () => {
    const service = create(true);
    channels['app-update-status'].next({ status: 'available', version: '2.0.0' });
    channels['app-update-status'].next(null as unknown as AppUpdateStatus);

    expect(service.status).toEqual({ status: 'available', version: '2.0.0' });
  });

  it('stops listening once destroyed', () => {
    const service = create(false);
    service.ngOnDestroy();

    channels['app-update-status'].next({ status: 'available' });
    connected$.next(true);

    expect(service.status).toBeNull();
    expect(statusRequests()).toEqual([]);
  });
});
