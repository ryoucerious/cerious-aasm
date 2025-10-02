import { ServerStateService } from './server-state.service';
import { MessagingService } from './messaging/messaging.service';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';

describe('ServerStateService', () => {
  let service: ServerStateService;
  let messagingMock: jasmine.SpyObj<MessagingService>;

  beforeEach(() => {
    messagingMock = jasmine.createSpyObj('MessagingService', ['receiveMessage']);
    messagingMock.receiveMessage.and.returnValue(new Subject<any>());
    service = new ServerStateService(messagingMock);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should map server states correctly', () => {
    expect(service.mapServerState('starting')).toBe('Starting');
    expect(service.mapServerState('running')).toBe('Running');
    expect(service.mapServerState('stopping')).toBe('Stopping');
    expect(service.mapServerState('stopped')).toBe('Stopped');
    expect(service.mapServerState('error')).toBe('Error');
    expect(service.mapServerState('already-running')).toBe('Already Running');
    expect(service.mapServerState('instance-folder-missing')).toBe('Instance Folder Missing');
    expect(service.mapServerState('not-installed')).toBe('Not-installed');
    expect(service.mapServerState('unknown')).toBe('Stopped');
    expect(service.mapServerState(null)).toBe('Stopped');
    expect(service.mapServerState(undefined)).toBe('Stopped');
    expect(service.mapServerState('custom')).toBe('Custom');
  });

  it('should determine if instance can be started', () => {
    expect(service.canStartInstance('stopped')).toBeTrue();
    expect(service.canStartInstance('error')).toBeTrue();
    expect(service.canStartInstance('unknown')).toBeTrue();
    expect(service.canStartInstance('running')).toBeFalse();
  });

  it('should determine if settings are locked', () => {
    expect(service.areSettingsLocked('starting')).toBeTrue();
    expect(service.areSettingsLocked('stopping')).toBeTrue();
    expect(service.areSettingsLocked('running')).toBeTrue();
    expect(service.areSettingsLocked('stopped')).toBeFalse();
  });

  it('should determine if backup settings are locked', () => {
    expect(service.areBackupSettingsLocked('starting')).toBeTrue();
    expect(service.areBackupSettingsLocked('stopping')).toBeTrue();
    expect(service.areBackupSettingsLocked('running')).toBeFalse();
    expect(service.areBackupSettingsLocked('stopped')).toBeFalse();
  });

  it('should get and clear logs for instance', () => {
    // Add logs manually
    (service as any).allLogs = [
      { instanceId: 'id1', line: 'log1' },
      { instanceId: 'id2', line: 'log2' },
      { instanceId: 'id1', line: 'log3' }
    ];
    expect(service.getLogsForInstance('id1')).toEqual(['log1', 'log3']);
    service.clearLogsForInstance('id1');
    expect(service.getLogsForInstance('id1')).toEqual([]);
  });

  it('should clean up subscriptions on destroy', () => {
    const sub = { unsubscribe: jasmine.createSpy('unsubscribe') };
    (service as any).subscriptions = [sub];
    service.ngOnDestroy();
    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it('should emit logs$ when bulk logs are received', () => {
    const subject = new Subject<any>();
    messagingMock.receiveMessage.and.callFake((channel: string) => channel === 'server-instance-bulk-logs' ? subject : new Subject<any>());
    service = new ServerStateService(messagingMock);
    const logs = 'line1\nline2\n';
    let emitted: any[] = [];
    service.logs$.subscribe(l => emitted = l);
    subject.next({ instanceId: 'id1', logs });
    expect(emitted.length).toBe(2);
    expect(emitted[0].line).toBe('line1');
    expect(emitted[1].line).toBe('line2');
  });

  it('should emit logs$ when get-server-instance-logs is received', () => {
    const subject = new Subject<any>();
    messagingMock.receiveMessage.and.callFake((channel: string) => channel === 'get-server-instance-logs' ? subject : new Subject<any>());
    service = new ServerStateService(messagingMock);
    let emitted: any[] = [];
    service.logs$.subscribe(l => emitted = l);
    subject.next({ instanceId: 'id2', log: 'a\nb' });
    expect(emitted.length).toBe(2);
    expect(emitted[0].line).toBe('a');
    expect(emitted[1].line).toBe('b');
  });

  it('should emit logs$ when individual log is received and avoid duplicates', () => {
    const subject = new Subject<any>();
    messagingMock.receiveMessage.and.callFake((channel: string) => channel === 'server-instance-log' ? subject : new Subject<any>());
    service = new ServerStateService(messagingMock);
    let emitted: any[] = [];
    service.logs$.subscribe(l => emitted = l);
    subject.next({ instanceId: 'id3', log: 'unique' });
    subject.next({ instanceId: 'id3', log: 'unique' }); // duplicate
    expect(emitted.length).toBe(1);
    expect(emitted[0].line).toBe('unique');
  });

  it('should trim logs to last 1000 per instance', () => {
    const subject = new Subject<any>();
    messagingMock.receiveMessage.and.callFake((channel: string) => channel === 'server-instance-bulk-logs' ? subject : new Subject<any>());
    service = new ServerStateService(messagingMock);
    let emitted: any[] = [];
    service.logs$.subscribe(l => emitted = l);
    const logs = Array(1100).fill('x').join('\n');
    subject.next({ instanceId: 'id4', logs });
    expect(emitted.length).toBe(1000);
  });
});
