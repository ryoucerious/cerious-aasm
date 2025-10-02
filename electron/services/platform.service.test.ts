import { PlatformService } from './platform.service';
import * as os from 'os';
import * as path from 'path';

jest.mock('os', () => ({
  homedir: jest.fn(() => '/home/user')
}));

describe('PlatformService', () => {
  let service: PlatformService;

  beforeEach(() => {
    service = new PlatformService();
    jest.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));
    // os.homedir is already mocked above
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('getNodeVersion returns node version', () => {
    const version = service.getNodeVersion();
    expect(typeof version).toBe('string');
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
    expect(service.getPlatform()).toBe('Linux');
  });

  it('getPlatform returns unknown for other', () => {
    Object.defineProperty(process, 'platform', { value: 'other' });
    expect(service.getPlatform()).toBe('other');
  });

  it('getConfigPath returns Electron app path if available', () => {
    const appMock = { getPath: jest.fn().mockReturnValue('/appData') };
    (global as any).app = appMock;
    const svc = new PlatformService();
    expect(svc.getConfigPath()).toContain('Cerious AASM');
  });

  it('getConfigPath returns Windows path', () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  expect(service.getConfigPath()).toContain('Cerious AASM');
  });

  it('getConfigPath returns Linux path', () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  expect(service.getConfigPath()).toContain('Cerious AASM');
  });

  it('getConfigPath returns macOS path', () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  expect(service.getConfigPath()).toContain('Cerious AASM');
  });

});
