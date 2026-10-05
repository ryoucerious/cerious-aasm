import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import { ServerInstanceService, withoutRuntimeFields } from './server-instance.service';
import { BACKUP_TIMEOUT_MS, MessagingService } from './messaging/messaging.service';
import { FieldDefinition, FieldDefinitionsService } from './field-definitions.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';
import { ServerInstance, ServerInstanceDraft } from '../models/server-instance.model';

describe('ServerInstanceService', () => {
  let messaging: jasmine.SpyObj<MessagingService>;
  let channels: Record<string, Subject<any>>;
  let connected$: BehaviorSubject<boolean>;
  const meta: FieldDefinition[] = [
    { tab: 'general', label: 'Max Players', key: 'maxPlayers', type: 'number', default: 70 },
    { tab: 'mods', label: 'Mods', key: 'mods', type: 'text', default: [] },
    { tab: 'general', label: 'Session', key: 'sessionName', type: 'text', default: 'From Meta' }
  ];

  const create = (isElectron = true) => new ServerInstanceService(
    messaging,
    { getFieldDefinitions: () => of(meta) } as FieldDefinitionsService,
    { connected$ } as unknown as WebSocketService,
    { isElectron } as IpcService
  );
  const requests = (channel: string) => messaging.sendMessage.calls.allArgs().filter(([c]) => c === channel);

  beforeEach(() => {
    channels = {};
    connected$ = new BehaviorSubject(false);
    messaging = jasmine.createSpyObj('MessagingService', ['receiveMessage', 'sendMessage']);
    messaging.receiveMessage.and.callFake(((channel: string): Observable<any> => channels[channel] ??= new Subject<any>()) as any);
    messaging.sendMessage.and.returnValue(of({ success: true }));
  });

  it('asks for the list once at startup in the desktop app', () => {
    create(true);
    connected$.next(false);
    expect(requests('get-server-instances').length).toBe(1);
  });

  it('asks again after a mesh sign-in, because the first ask was refused', () => {
    create(true);
    channels['mesh-auth-changed'].next({});
    expect(requests('get-server-instances').length).toBe(2);
  });

  it('asks for the list once per connection in the web UI', () => {
    create(false);
    expect(requests('get-server-instances').length).toBe(0);

    connected$.next(true);
    expect(requests('get-server-instances').length).toBe(1);

    connected$.next(false);
    connected$.next(true);
    expect(requests('get-server-instances').length).toBe(2);
  });

  it('passes on the list the backend broadcasts', () => {
    const service = create();
    const lists: ServerInstance[][] = [];
    service.getInstances().subscribe(list => lists.push(list));

    channels['server-instances'].next([{ id: '1', name: 'Test' }]);
    channels['server-instances'].next('not a list');

    expect(lists).toEqual([[{ id: '1', name: 'Test' }], []]);
  });

  it('creates a server from the meta defaults on a first run with none', () => {
    const service = create();
    const saved = { id: 'new', name: 'My Server' };
    messaging.sendMessage.and.callFake(((channel: string) =>
      channel === 'save-server-instance' ? of({ success: true, instance: saved }) : of({})) as any);
    let active = null as ServerInstance | null;
    service.getActiveServer().subscribe(server => active = server);

    channels['server-instances'].next([]);

    const [, payload] = requests('save-server-instance')[0] as [string, { instance: ServerInstanceDraft }];
    expect(payload.instance).toEqual(jasmine.objectContaining({ name: 'My Server', sessionName: 'My Server', maxPlayers: 70 }));
    expect(active).toEqual(saved);

    channels['server-instances'].next([]);
    expect(requests('save-server-instance').length).toBe(1);
  });

  it('does not create a server when some already exist', () => {
    create();
    channels['server-instances'].next([{ id: '1', name: 'Existing' }]);
    channels['server-instances'].next([]);
    expect(requests('save-server-instance').length).toBe(0);
  });

  it('should set active server and get active server via getActiveServer', () => {
    const service = create();
    const server = { id: '1', name: 'Test' };
    let active = null as ServerInstance | null;
    service.setActiveServer(server);
    service.getActiveServer().subscribe(value => active = value);
    expect(active).toEqual(server);
  });

  it('merges edits to the active server, keeping its state unless one is sent', () => {
    const service = create();
    let active = null as ServerInstance | null;
    service.getActiveServer().subscribe(value => active = value);
    service.setActiveServer({ id: '1', name: 'Test', state: 'running' });

    channels['server-instance-updated'].next({ id: '1', name: 'Renamed' });
    expect(active).toEqual({ id: '1', name: 'Renamed', state: 'running' });

    channels['server-instance-updated'].next({ id: '1', state: 'stopped' });
    expect(active!.state).toBe('stopped');

    channels['server-instance-updated'].next({ id: 'other', name: 'Nope' });
    expect(active!.name).toBe('Renamed');
  });

  it('should save a changed server instance', () => {
    const service = create();
    channels['server-instances'].next([{ id: '1', name: 'Test', mods: ['1', '2', '3'] }]);
    messaging.sendMessage.and.returnValue(of({ success: true, instance: { id: '1', name: 'Test' } }));
    const instance = { id: '1', name: 'Test', mods: ['1', '2', '4'] };
    let result: unknown;

    service.save(instance).subscribe(res => result = res);

    expect(messaging.sendMessage).toHaveBeenCalledWith('save-server-instance', { instance });
    expect(result).toEqual({ success: true, instance: { id: '1', name: 'Test' } });
  });

  it('answers an unchanged save without a round trip', () => {
    const service = create();
    channels['server-instances'].next([{ id: '1', name: 'Test', mods: ['1', '2'] }]);
    let result: unknown;

    service.save({ id: '1', name: 'Test', mods: ['1', '2'] }).subscribe(res => result = res);

    expect(result).toEqual({ success: true, unchanged: true });
    expect(requests('save-server-instance').length).toBe(0);
  });

  it('always sends a new server', () => {
    const service = create();
    service.save({ name: 'New' }).subscribe();
    expect(requests('save-server-instance').length).toBe(1);
  });

  it('builds defaults from the meta file', () => {
    const service = create();
    let defaults: ServerInstanceDraft | undefined;
    service.getDefaultInstanceFromMeta().subscribe(value => defaults = value);
    expect(defaults).toEqual(jasmine.objectContaining({
      name: 'My Server', sessionName: 'From Meta', maxPlayers: 70, gamePort: 7777, rconPort: 27020, queryPort: 27015, multiHome: ''
    }));
  });

  it('gives each caller its own defaults', () => {
    const service = create();
    let first!: ServerInstanceDraft;
    let second!: ServerInstanceDraft;
    service.getDefaultInstanceFromMeta().subscribe(value => first = value);
    first.mods!.push('edited');
    first.name = 'edited';

    service.getDefaultInstanceFromMeta().subscribe(value => second = value);

    expect(second.name).toBe('My Server');
    expect(second.mods).toEqual([]);
  });

  it('should delete server instance', () => {
    create().delete('1').subscribe();
    expect(messaging.sendMessage).toHaveBeenCalledWith('delete-server-instance', { id: '1' });
  });

  it('gives a backup import the long timeout', () => {
    create().importServerFromBackup('ServerName', 'path', 'data', 'file').subscribe();
    expect(messaging.sendMessage).toHaveBeenCalledWith('import-server-from-backup', {
      serverName: 'ServerName',
      backupFilePath: 'path',
      fileData: 'data',
      fileName: 'file'
    }, { timeoutMs: BACKUP_TIMEOUT_MS });
  });

  it('keeps quiet when the list request goes unanswered', () => {
    messaging.sendMessage.and.returnValue(new Observable(subscriber => subscriber.error(new Error('Timeout has occurred'))));
    expect(() => create()).not.toThrow();
  });

  it('should clean up subscriptions on destroy', () => {
    const service = create();
    service.ngOnDestroy();
    expect(Object.values(channels).every(channel => !channel.observed)).toBeTrue();
    expect(connected$.observed).toBeFalse();
  });

  it('reorders servers', () => {
    create().reorderServers(['b', 'a']).subscribe();
    expect(messaging.sendMessage).toHaveBeenCalledWith('reorder-server-instances', { orderedIds: ['b', 'a'] });
  });

  it('copies only the settings of a server, not what its process is doing', () => {
    const live: ServerInstance = {
      id: 'a', name: 'Alpha', maxPlayers: 20, crossplay: ['Steam (PC)'],
      state: 'running', status: 'online', players: 4, cpu: 12, memory: 9000, startedAt: 1
    };
    const settings = withoutRuntimeFields(live);
    expect(settings).toEqual({ id: 'a', name: 'Alpha', maxPlayers: 20, crossplay: ['Steam (PC)'] });
    expect(live.state).toBe('running');
  });
});
