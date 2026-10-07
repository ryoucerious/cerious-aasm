import { ServerStateService } from './server-state.service';
import { MessagingService } from './messaging/messaging.service';
import { Subject } from 'rxjs';

describe('ServerStateService', () => {
  let service: ServerStateService;
  let messagingMock: jasmine.SpyObj<MessagingService>;
  let channels: Record<string, Subject<any>>;

  beforeEach(() => {
    channels = {};
    messagingMock = jasmine.createSpyObj('MessagingService', ['receiveMessage']);
    messagingMock.receiveMessage.and.callFake((channel: string) => channels[channel] ??= new Subject<any>());
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

  it('should determine if settings are locked', () => {
    expect(service.areSettingsLocked('starting')).toBeTrue();
    expect(service.areSettingsLocked('stopping')).toBeTrue();
    expect(service.areSettingsLocked('running')).toBeTrue();
    // Its machine cannot be reached: a change would not get there.
    expect(service.areSettingsLocked('unreachable')).toBeTrue();
    expect(service.areSettingsLocked('stopped')).toBeFalse();
  });

  it('should get and clear logs for instance', () => {
    channels['server-instance-bulk-logs'].next({ instanceId: 'id1', logs: 'log1\nlog3' });
    channels['server-instance-bulk-logs'].next({ instanceId: 'id2', logs: 'log2' });
    expect(service.getLogsForInstance('id1')).toEqual(['log1', 'log3']);

    service.clearLogsForInstance('id1');

    expect(service.getLogsForInstance('id1')).toEqual([]);
    expect(service.getLogsForInstance('id2')).toEqual(['log2']);
  });

  it('should clean up subscriptions on destroy', () => {
    service.ngOnDestroy();
    expect(Object.values(channels).every(channel => !channel.observed)).toBeTrue();
  });

  it('loads a bulk log, replacing what was there', () => {
    const changed: string[] = [];
    service.logsChanged$.subscribe(id => changed.push(id));
    channels['server-instance-log'].next({ instanceId: 'id1', log: 'old' });

    channels['server-instance-bulk-logs'].next({ instanceId: 'id1', logs: 'line1\nline2\n' });

    expect(service.getLogsForInstance('id1')).toEqual(['line1', 'line2']);
    expect(changed).toEqual(['id1', 'id1']);
  });

  it('loads the reply to get-server-instance-logs, as text or lines', () => {
    channels['get-server-instance-logs'].next({ instanceId: 'id2', log: 'a\nb' });
    expect(service.getLogsForInstance('id2')).toEqual(['a', 'b']);

    channels['get-server-instance-logs'].next({ instanceId: 'id2', log: ['c', '', 'd'] });
    expect(service.getLogsForInstance('id2')).toEqual(['c', 'd']);
  });

  it('skips a live line that repeats the end of the bulk load, once', () => {
    channels['server-instance-bulk-logs'].next({ instanceId: 'id3', logs: 'a\nb' });
    channels['server-instance-log'].next({ instanceId: 'id3', log: 'b' });
    channels['server-instance-log'].next({ instanceId: 'id3', log: 'b' });
    expect(service.getLogsForInstance('id3')).toEqual(['a', 'b', 'b']);
  });

  it('keeps a line the server legitimately logs twice', () => {
    channels['server-instance-log'].next({ instanceId: 'id3', log: 'Saving world...' });
    channels['server-instance-log'].next({ instanceId: 'id3', log: 'World saved' });
    channels['server-instance-log'].next({ instanceId: 'id3', log: 'Saving world...' });
    expect(service.getLogsForInstance('id3')).toEqual(['Saving world...', 'World saved', 'Saving world...']);
  });

  it('gives a new array on each change, so bound views update', () => {
    channels['server-instance-log'].next({ instanceId: 'id5', log: 'one' });
    const before = service.getLogsForInstance('id5');
    expect(service.getLogsForInstance('id5')).toBe(before);

    channels['server-instance-log'].next({ instanceId: 'id5', log: 'two' });

    expect(service.getLogsForInstance('id5')).not.toBe(before);
  });

  it('should trim logs to last 1000 per instance', () => {
    const lines = Array.from({ length: 1100 }, (_, i) => `line ${i}`);
    channels['server-instance-bulk-logs'].next({ instanceId: 'id4', logs: lines.join('\n') });
    expect(service.getLogsForInstance('id4').length).toBe(1000);
    expect(service.getLogsForInstance('id4')[0]).toBe('line 100');

    channels['server-instance-log'].next({ instanceId: 'id4', log: 'newest' });

    const log = service.getLogsForInstance('id4');
    expect(log.length).toBe(1000);
    expect(log[0]).toBe('line 101');
    expect(log[999]).toBe('newest');
  });
});
