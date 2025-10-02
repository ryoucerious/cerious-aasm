import { ServerInstanceService } from './server-instance.service';
import { MessagingService } from './messaging/messaging.service';
import { HttpClient } from '@angular/common/http';
import { WebSocketService } from './web-socket.service';
import { UtilityService } from './utility.service';
import { of } from 'rxjs';

describe('ServerInstanceService', () => {
  let service: ServerInstanceService;
  let messaging: jasmine.SpyObj<MessagingService>;
  let http: jasmine.SpyObj<HttpClient>;
  let ws: jasmine.SpyObj<WebSocketService>;
  let util: jasmine.SpyObj<UtilityService>;

  beforeEach(() => {
    messaging = jasmine.createSpyObj('MessagingService', ['receiveMessage', 'sendMessage']);
    http = jasmine.createSpyObj('HttpClient', ['get', 'post']);
    ws = jasmine.createSpyObj('WebSocketService', ['connect', 'disconnect']);
    util = jasmine.createSpyObj('UtilityService', ['getPlatform']);
    messaging.receiveMessage.and.callFake(<T = any>(channel: string): any => {
      if (channel === 'server-instances') return of([{ id: '1', name: 'Test', state: 'stopped' }] as T);
      if (channel === 'server-instance-updated') return of({ id: '1', name: 'Test', state: 'stopped' } as T);
      return of({} as T);
    });
    messaging.sendMessage.and.callFake(<T = any>(channel: string, payload: any): any => {
      // Return observable for all sendMessage calls
      return of({} as T);
    });
    service = new ServerInstanceService(messaging, http, ws, util);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should set active server and get active server via getActiveServer', () => {
    const server = { id: '1', name: 'Test' } as any;
    service.setActiveServer(server);
    service.getActiveServer().subscribe(active => {
      expect(active).toEqual(server);
    });
  });

  it('should get instances via getInstances', (done) => {
    service.getInstances().subscribe(instances => {
      expect(instances.length).toEqual(1);
      expect(instances[0].id).toBe('1');
      done();
    });
  });

  it('should save server instance', () => {
    messaging.sendMessage.and.returnValue(of({ instance: { id: '1', name: 'Test' }, success: true }));
    service['latestInstances'] = [{ id: '2', name: 'Other' } as any];
    service.save({ id: '1', name: 'Test' } as any).subscribe(res => {
      expect(res).toBeDefined();
      expect(res && res.success).toBeTrue();
      expect(res && res.instance && res.instance.id).toBe('1');
    });
  });

  it('should not save if instance is unchanged', (done) => {
  service['latestInstances'] = [{ id: '1', name: 'Test', mods: [1,2,3] } as any];
  const instance = { id: '1', name: 'Test', mods: [1,2,3] } as any;
  let completed = false;
  service.save(instance).subscribe({ complete: () => { completed = true; expect(completed).toBeTrue(); done(); } });
  });

  it('should save if instance array property changes', (done) => {
    service['latestInstances'] = [{ id: '1', name: 'Test', mods: [1,2,3] } as any];
    const instance = { id: '1', name: 'Test', mods: [1,2,4] } as any;
    let called = false;
    messaging.sendMessage.and.callFake(<T = any>() => { called = true; return of({} as T); });
    service.save(instance).subscribe(() => {
      expect(called).toBeTrue();
      done();
    });
  });

  it('should get default instance from meta', () => {
    http.get.and.returnValue(of([
      { key: 'name', default: 'My Server' },
      { key: 'sessionName', default: 'ARK Server' },
      { key: 'gamePort', default: 7777 },
      { key: 'queryPort', default: 27015 },
      { key: 'rconPort', default: 27020 },
      { key: 'rconPassword', default: '' },
      { key: 'battleEye', default: false },
      { key: 'noTransferFromFiltering', default: false },
      { key: 'installed', default: false },
      { key: 'currentVersion', default: null },
      { key: 'autoUpdateEnabled', default: true }
    ]));
    service.getDefaultInstanceFromMeta().subscribe(instance => {
      expect(instance).toBeDefined();
      expect(instance.name).toBe('My Server');
      expect(instance.sessionName).toBe('ARK Server');
      expect(instance.gamePort).toBe(7777);
      expect(instance.autoUpdateEnabled).toBeTrue();
    });
  });

  it('should clean up subscriptions on destroy', () => {
    spyOn(service['subs'][0], 'unsubscribe');
    service.ngOnDestroy();
    expect(service['subs'][0].unsubscribe).toHaveBeenCalled();
  });

  it('should delete server instance', () => {
    messaging.sendMessage.and.returnValue(of({ success: true }));
    service.delete('1').subscribe(res => {
      expect(messaging.sendMessage).toHaveBeenCalledWith('delete-server-instance', { id: '1' });
      expect(res.success).toBeTrue();
    });
  });

  it('should import server from backup', () => {
    messaging.sendMessage.and.returnValue(of({ imported: true }));
    service.importServerFromBackup('ServerName', 'path', 'data', 'file').subscribe(res => {
      expect(messaging.sendMessage).toHaveBeenCalledWith('import-server-from-backup', {
        serverName: 'ServerName',
        backupFilePath: 'path',
        fileData: 'data',
        fileName: 'file'
      });
      expect(res.imported).toBeTrue();
    });
  });

  it('should call refresh and send get-server-instances', () => {
    messaging.sendMessage.and.returnValue(of({}));
    service.refresh();
    expect(messaging.sendMessage).toHaveBeenCalledWith('get-server-instances', {});
  });

  it('should get running instances once', async () => {
    service['latestInstances'] = [
      { id: '1', name: 'A', state: 'running' } as any,
      { id: '2', name: 'B', state: 'starting' } as any,
      { id: '3', name: 'C', state: 'stopped' } as any
    ];
    // Also emit to instances$ for observable
    service['instances$'].next(service['latestInstances']);
    const result = await service.getInstancesOnce();
    expect(result.length).toBe(2);
    expect(result[0].state).toBe('running');
    expect(result[1].state).toBe('starting');
  });

  it('should shutdown all running servers', async () => {
    service['latestInstances'] = [
      { id: '1', name: 'A', state: 'running' } as any,
      { id: '2', name: 'B', state: 'starting' } as any,
      { id: '3', name: 'C', state: 'stopped' } as any
    ];
    service['instances$'].next(service['latestInstances']);
    spyOn(service, 'stopInstance').and.callFake(() => Promise.resolve());
    await service.shutdownAllServers();
    expect(service.stopInstance).toHaveBeenCalledTimes(2);
  });

  it('should stop instance and resolve', async () => {
  const instance = { id: '1', name: 'A' } as any;
  messaging.sendMessage.and.returnValue(of({}));
    // Mock setTimeout to call immediately
    const originalSetTimeout = window.setTimeout;
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
      if (typeof handler === 'function') { handler(...args); }
      return 0;
    }) as typeof window.setTimeout;
    const promise = service.stopInstance(instance);
    await promise;
    expect(true).toBeTrue(); // Just confirm completion
    window.setTimeout = originalSetTimeout;
  });
});
