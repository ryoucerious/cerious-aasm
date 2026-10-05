import { GlobalConfigService } from './global-config.service';
import { MessagingService } from './messaging/messaging.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';
import { GlobalConfig } from '../interfaces/global-config.interface';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';

describe('GlobalConfigService', () => {
  let service: GlobalConfigService;
  let messaging: jasmine.SpyObj<MessagingService>;
  let broadcasts: Subject<GlobalConfig>;
  let connected$: BehaviorSubject<boolean>;

  const create = (isElectron = false) => new GlobalConfigService(
    messaging,
    { connected$ } as unknown as WebSocketService,
    { isElectron } as IpcService
  );
  const loads = () => messaging.sendMessage.calls.allArgs().filter(([channel]) => channel === 'get-global-config');

  const config = (overrides: Partial<GlobalConfig> = {}): GlobalConfig => ({
    startWebServerOnLoad: true,
    webServerPort: 3000,
    authenticationEnabled: false,
    authenticationUsername: '',
    authenticationPasswordSet: false,
    maxBackupDownloadSizeMB: 100,
    ...overrides
  });

  beforeEach(() => {
    broadcasts = new Subject<GlobalConfig>();
    connected$ = new BehaviorSubject(false);
    messaging = jasmine.createSpyObj('MessagingService', ['sendMessage', 'receiveMessage']);
    messaging.receiveMessage.and.returnValue(broadcasts);
    service = create();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('loads the settings from the reply to its request', async () => {
    const cfg = config();
    messaging.sendMessage.and.returnValue(of({ ...cfg, requestId: 'r1' }));

    const result = await service.loadConfig();

    expect(messaging.sendMessage).toHaveBeenCalledWith('get-global-config', {});
    expect(result).toEqual(cfg);
    expect(service.webServerPort).toBe(3000);
  });

  it('rejects when the backend could not read the settings', async () => {
    messaging.sendMessage.and.returnValue(of({ error: 'Settings file is unreadable', requestId: 'r1' }));
    await expectAsync(service.loadConfig()).toBeRejectedWithError('Settings file is unreadable');
  });

  it('rejects when the request fails', async () => {
    messaging.sendMessage.and.returnValue(throwError(() => new Error('Timeout has occurred')));
    await expectAsync(service.loadConfig()).toBeRejectedWithError('Timeout has occurred');
  });

  describe('loading on its own', () => {
    const reply = () => of({ ...config({ webServerPort: 4000 }), requestId: 'r1' });
    const settle = () => new Promise(resolve => setTimeout(resolve));

    beforeEach(() => {
      messaging.sendMessage.and.callFake(reply as any);
    });

    it('asks once at startup in the desktop app, which has no socket', () => {
      create(true);
      connected$.next(false);
      expect(loads().length).toBe(1);
    });

    it('asks nothing in the web UI before the socket is up, since a refused session drops the request', () => {
      expect(loads()).toEqual([]);
    });

    it('asks once when the socket comes up, and again on each reconnect', () => {
      connected$.next(true);
      expect(loads().length).toBe(1);

      connected$.next(false);
      expect(loads().length).toBe(1);

      connected$.next(true);
      expect(loads().length).toBe(2);
    });

    it('asks at once when the socket is already up', () => {
      connected$.next(true);
      const before = loads().length;

      create();

      expect(loads().length).toBe(before + 1);
    });

    it('hands the settings to whoever is listening, including a listener that comes late', async () => {
      const early: number[] = [];
      const late: number[] = [];
      const desktop = create(true);
      desktop.config$.subscribe(cfg => early.push(cfg.webServerPort));
      await settle();
      desktop.config$.subscribe(cfg => late.push(cfg.webServerPort));

      expect(early).toEqual([4000]);
      expect(late).toEqual([4000]);
      expect(desktop.webServerPort).toBe(4000);
    });

    it('passes on settings another client saved', () => {
      const seen: number[] = [];
      service.config$.subscribe(cfg => seen.push(cfg.webServerPort));

      broadcasts.next(config({ webServerPort: 8080 }));

      expect(seen).toEqual([8080]);
    });

    it('says so when the settings cannot be loaded', async () => {
      spyOn(console, 'error');
      messaging.sendMessage.and.returnValue(throwError(() => new Error('Timeout has occurred')));

      create(true);
      await settle();

      expect(console.error).toHaveBeenCalledWith('[global-config] Could not load the settings:', new Error('Timeout has occurred'));
    });

    it('says so when the settings cannot be loaded once the socket is up', async () => {
      spyOn(console, 'error');
      messaging.sendMessage.and.returnValue(throwError(() => new Error('Timeout has occurred')));

      connected$.next(true);
      await settle();

      expect(console.error).toHaveBeenCalledWith('[global-config] Could not load the settings:', new Error('Timeout has occurred'));
    });

    it('tries again on the next connection after a failure', async () => {
      spyOn(console, 'error');
      messaging.sendMessage.and.returnValues(
        throwError(() => new Error('Timeout has occurred')),
        reply()
      );

      connected$.next(true);
      await settle();
      connected$.next(false);
      connected$.next(true);
      await settle();

      expect(loads().length).toBe(2);
      expect(service.webServerPort).toBe(4000);
    });
  });

  it('follows settings saved by another client', () => {
    broadcasts.next(config({ webServerPort: 8080 }));
    expect(service.webServerPort).toBe(8080);
  });

  it('should save config and resolve on success', async () => {
    const cfg = config();
    messaging.sendMessage.and.returnValue(of({ success: true }));
    await expectAsync(service.saveConfig(cfg)).toBeResolved();
    expect(messaging.sendMessage).toHaveBeenCalledWith('set-global-config', { config: cfg });
    expect(service.startWebServerOnLoad).toBeTrue();
  });

  it('should reject saveConfig on error', async () => {
    messaging.sendMessage.and.returnValue(of({ success: false, error: 'fail' }));
    await expectAsync(service.saveConfig(config())).toBeRejectedWithError('fail');
  });

  it('rejects a save that got an empty reply', async () => {
    messaging.sendMessage.and.returnValue(of(null));
    await expectAsync(service.saveConfig(config())).toBeRejectedWithError('Failed to save config');
  });

  it('rejects a save whose request failed', async () => {
    messaging.sendMessage.and.returnValue(throwError(() => new Error('Timeout has occurred')));
    await expectAsync(service.saveConfig(config())).toBeRejectedWithError('Timeout has occurred');
  });

  describe('settings', () => {
    beforeEach(() => {
      broadcasts.next(config({ startWebServerOnLoad: false }));
      messaging.sendMessage.and.returnValue(of({ success: true }));
    });

    it('should get/set startWebServerOnLoad', () => {
      service.startWebServerOnLoad = true;
      expect(service.startWebServerOnLoad).toBeTrue();
    });

    it('should get/set webServerPort', () => {
      service.webServerPort = 8080;
      expect(service.webServerPort).toBe(8080);
      expect(messaging.sendMessage).toHaveBeenCalledWith('set-global-config', { config: jasmine.objectContaining({ webServerPort: 8080 }) });
    });

    it('should get/set authenticationEnabled', () => {
      service.authenticationEnabled = true;
      expect(service.authenticationEnabled).toBeTrue();
    });

    it('should get/set maxBackupDownloadSizeMB', () => {
      service.maxBackupDownloadSizeMB = 200;
      expect(service.maxBackupDownloadSizeMB).toBe(200);
    });

    it('logs a setting the backend refused to save instead of leaving the rejection unhandled', async () => {
      spyOn(console, 'error');
      messaging.sendMessage.and.returnValue(of({ success: false, error: 'Invalid web server port' }));

      service.webServerPort = 80;
      await new Promise(resolve => setTimeout(resolve));

      expect(console.error).toHaveBeenCalledWith('[global-config] Could not save the settings:', new Error('Invalid web server port'));
    });
  });

  it('changes nothing and sends nothing before the settings are known', () => {
    service.webServerPort = 8080;
    expect(messaging.sendMessage).not.toHaveBeenCalled();
    expect(service.webServerPort).toBe(3000);
  });

  it('should return default values if config is null', () => {
    expect(service.startWebServerOnLoad).toBeFalse();
    expect(service.webServerPort).toBe(3000);
    expect(service.authenticationEnabled).toBeFalse();
    expect(service.maxBackupDownloadSizeMB).toBe(100);
  });
});
