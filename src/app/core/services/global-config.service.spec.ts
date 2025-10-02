import { GlobalConfigService } from './global-config.service';
import { MessagingService } from './messaging/messaging.service';
import { of } from 'rxjs';
describe('GlobalConfigService', () => {
  let service: GlobalConfigService;
  let messaging: jasmine.SpyObj<MessagingService>;
  beforeEach(() => {
  messaging = jasmine.createSpyObj('MessagingService', ['sendMessage', 'receiveMessage']);
  messaging.receiveMessage.and.returnValue(of({}));
  service = new GlobalConfigService(messaging);
  });
  it('should be created', () => {
    expect(service).toBeTruthy();
  });
  it('should load config and set config property', async () => {
    const cfg = { startWebServerOnLoad: true } as any;
    messaging.receiveMessage.and.returnValue(of(cfg));
    messaging.sendMessage.and.returnValue(of({}));
    const result = await service.loadConfig();
    expect(result).toEqual(cfg);
    expect(service['config']).toEqual(cfg);
  });

  it('should save config and resolve on success', async () => {
    const cfg = { startWebServerOnLoad: true } as any;
    messaging.sendMessage.and.returnValue(of({ success: true }));
    await expectAsync(service.saveConfig(cfg)).toBeResolved();
    expect(service['config']).toEqual(cfg);
  });

  it('should reject saveConfig on error', async () => {
    const cfg = { startWebServerOnLoad: true } as any;
    messaging.sendMessage.and.returnValue(of({ success: false, error: 'fail' }));
    await expectAsync(service.saveConfig(cfg)).toBeRejectedWith('fail');
  });

  it('should get/set startWebServerOnLoad', () => {
    service['config'] = { startWebServerOnLoad: false } as any;
    messaging.sendMessage.and.returnValue(of({ success: true }));
    service.startWebServerOnLoad = true;
    expect(service['config']?.startWebServerOnLoad).toBeTrue();
  });

  it('should get/set webServerPort', () => {
    service['config'] = { webServerPort: 3000 } as any;
    messaging.sendMessage.and.returnValue(of({ success: true }));
    service.webServerPort = 8080;
    expect(service['config']?.webServerPort).toBe(8080);
  });

  it('should get/set authenticationEnabled', () => {
    service['config'] = { authenticationEnabled: false } as any;
    messaging.sendMessage.and.returnValue(of({ success: true }));
    service.authenticationEnabled = true;
    expect(service['config']?.authenticationEnabled).toBeTrue();
  });

  it('should get/set authenticationUsername', () => {
    service['config'] = { authenticationUsername: '' } as any;
    messaging.sendMessage.and.returnValue(of({ success: true }));
    service.authenticationUsername = 'user';
    expect(service['config']?.authenticationUsername).toBe('user');
  });

  it('should get/set authenticationPassword', () => {
    service['config'] = { authenticationPassword: '' } as any;
    messaging.sendMessage.and.returnValue(of({ success: true }));
    service.authenticationPassword = 'pass';
    expect(service['config']?.authenticationPassword).toBe('pass');
  });

  it('should get/set maxBackupDownloadSizeMB', () => {
    service['config'] = { maxBackupDownloadSizeMB: 100 } as any;
    messaging.sendMessage.and.returnValue(of({ success: true }));
    service.maxBackupDownloadSizeMB = 200;
    expect(service['config']?.maxBackupDownloadSizeMB).toBe(200);
  });

  it('should return default values if config is null', () => {
    service['config'] = null;
    expect(service.startWebServerOnLoad).toBeFalse();
    expect(service.webServerPort).toBe(3000);
    expect(service.authenticationEnabled).toBeFalse();
    expect(service.authenticationUsername).toBe('');
    expect(service.authenticationPassword).toBe('');
    expect(service.maxBackupDownloadSizeMB).toBe(100);
  });
});
