import { ProtonService } from './proton.service';
import { of } from 'rxjs';

describe('ProtonService', () => {
  let service: ProtonService;
  let originalElectronAPI: any;

  beforeEach(() => {
    originalElectronAPI = window.electronAPI;
    window.electronAPI = {
      checkProtonInstalled: jasmine.createSpy('checkProtonInstalled').and.returnValue(Promise.resolve({ success: true, installed: true, path: '/proton' })),
      installProton: jasmine.createSpy('installProton').and.returnValue(Promise.resolve({ success: true })),
      getProtonDir: jasmine.createSpy('getProtonDir').and.returnValue(Promise.resolve({ success: true, path: '/proton' })),
      getPlatformInfo: jasmine.createSpy('getPlatformInfo').and.returnValue(Promise.resolve({ success: true, platform: 'linux', needsProton: true, protonInstalled: true, ready: true }))
    };
    service = new ProtonService();
  });

  afterEach(() => {
    window.electronAPI = originalElectronAPI;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should check if Proton is installed', (done) => {
    service.checkProtonInstalled().subscribe(res => {
      expect(res.success).toBeTrue();
      expect(res.installed).toBeTrue();
      expect(res.path).toBe('/proton');
      done();
    });
  });

  it('should install Proton', (done) => {
    service.installProton().subscribe(res => {
      expect(res.success).toBeTrue();
      done();
    });
  });

  it('should get Proton directory', (done) => {
    service.getProtonDirectory().subscribe(res => {
      expect(res.success).toBeTrue();
      expect(res.path).toBe('/proton');
      done();
    });
  });

  it('should get platform info', (done) => {
    service.getPlatformInfo().subscribe(res => {
      expect(res.success).toBeTrue();
      expect(res.platform).toBe('linux');
      expect(res.needsProton).toBeTrue();
      expect(res.protonInstalled).toBeTrue();
      expect(res.ready).toBeTrue();
      done();
    });
  });

  it('should handle missing Electron API for checkProtonInstalled', (done) => {
    window.electronAPI = undefined;
    service.checkProtonInstalled().subscribe(res => {
      expect(res.success).toBeFalse();
      expect(res.error).toBe('Electron API not available');
      done();
    });
  });

  it('should handle missing Electron API for installProton', (done) => {
    window.electronAPI = undefined;
    service.installProton().subscribe(res => {
      expect(res.success).toBeFalse();
      expect(res.error).toBe('Electron API not available');
      done();
    });
  });

  it('should handle missing Electron API for getProtonDirectory', (done) => {
    window.electronAPI = undefined;
    service.getProtonDirectory().subscribe(res => {
      expect(res.success).toBeFalse();
      expect(res.error).toBe('Electron API not available');
      done();
    });
  });

  it('should handle missing Electron API for getPlatformInfo', (done) => {
    window.electronAPI = undefined;
    service.getPlatformInfo().subscribe(res => {
      expect(res.success).toBeFalse();
      expect(res.error).toBe('Electron API not available');
      done();
    });
  });
});
