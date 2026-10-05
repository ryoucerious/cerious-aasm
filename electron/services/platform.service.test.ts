import { PlatformService } from './platform.service';
import * as platformUtils from '../utils/platform.utils';

jest.mock('os', () => ({
  homedir: jest.fn(() => '/home/user')
}));

describe('PlatformService', () => {
  const originalPlatform = process.platform;
  const originalAppData = process.env.APPDATA;
  let service: PlatformService;

  beforeEach(() => {
    service = new PlatformService();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
  });

  it('getNodeVersion returns node version', () => {
    expect(typeof service.getNodeVersion()).toBe('string');
  });

  it('getElectronVersion returns electron version', () => {
    const version = service.getElectronVersion();
    expect(typeof version === 'string' || version === null).toBe(true);
  });

  it('getPlatform returns Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(service.getPlatform()).toBe('Windows');
  });

  it('getPlatform returns macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(service.getPlatform()).toBe('macOS');
  });

  it('getPlatform returns Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    jest.spyOn(service, 'isRunningInDocker').mockReturnValue(false);
    expect(service.getPlatform()).toBe('Linux');
  });

  it('getPlatform returns Linux (Docker) when running in the container', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    jest.spyOn(service, 'isRunningInDocker').mockReturnValue(true);
    expect(service.getPlatform()).toBe('Linux (Docker)');
  });

  it('getPlatform returns unknown for other', () => {
    Object.defineProperty(process, 'platform', { value: 'other' });
    expect(service.getPlatform()).toBe('other');
  });

  it('isRunningInDocker asks the platform utils', () => {
    jest.spyOn(platformUtils, 'isRunningInDocker').mockReturnValue(true);
    expect(service.isRunningInDocker()).toBe(true);
  });

  describe('getConfigPath', () => {
    it('is the app data folder on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.APPDATA = 'C:/Users/user/AppData/Roaming';

      expect(service.getConfigPath()).toBe('C:/Users/user/AppData/Roaming/Cerious AASM');
    });

    // It named ~/.config/Cerious AASM, which the app never creates on Linux, so the dashboard's
    // disk reading of that path always failed.
    it('is the folder the app really uses on Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      expect(service.getConfigPath()).toBe('/home/user/.local/share/cerious-aasm');
    });

    it('is Unknown on a platform the app does not support', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      expect(service.getConfigPath()).toBe('Unknown');
    });
  });
});
