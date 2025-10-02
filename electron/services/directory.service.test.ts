import { DirectoryService } from './directory.service';
import * as platformUtils from '../utils/platform.utils';
import * as instanceUtils from '../utils/ark/instance.utils';
import * as validationUtils from '../utils/validation.utils';
import * as electron from 'electron';
import * as path from 'path';
import * as fs from 'fs';

jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  resolve: jest.fn((...args) => args.join('/')),
  isAbsolute: jest.fn(() => true)
}));

jest.mock('electron', () => ({
  shell: {
    openPath: jest.fn()
  }
}));

describe('DirectoryService', () => {
  let service: DirectoryService;

  beforeEach(() => {
    service = new DirectoryService();
    jest.spyOn(platformUtils, 'getDefaultInstallDir').mockReturnValue('INSTALL_DIR');
    (electron.shell.openPath as jest.Mock).mockResolvedValue('');
    jest.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));
    jest.spyOn(path, 'resolve').mockImplementation((...args) => args.join('/'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('openConfigDirectory opens config dir', async () => {
    const result = await service.openConfigDirectory();
    expect(result.success).toBe(true);
    expect(result.configDir).toBe('INSTALL_DIR');
    expect(electron.shell.openPath).toHaveBeenCalledWith('INSTALL_DIR');
  });

  it('openConfigDirectory handles error', async () => {
    (electron.shell.openPath as jest.Mock).mockRejectedValue(new Error('fail'));
    const result = await service.openConfigDirectory();
    expect(result.success).toBe(false);
    expect(result.error).toBe('fail');
  });

  it('openInstanceDirectory validates instanceId', async () => {
    jest.spyOn(validationUtils, 'validateInstanceId').mockReturnValue(false);
    const result = await service.openInstanceDirectory('badid');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid instance ID');
  });

  it('openInstanceDirectory handles missing instance', async () => {
    jest.spyOn(validationUtils, 'validateInstanceId').mockReturnValue(true);
    jest.spyOn(instanceUtils, 'getInstance').mockResolvedValue(null);
    const result = await service.openInstanceDirectory('id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Instance not found');
  });

  it('openInstanceDirectory opens valid instance', async () => {
    jest.spyOn(validationUtils, 'validateInstanceId').mockReturnValue(true);
    jest.spyOn(instanceUtils, 'getInstance').mockResolvedValue({});
    jest.spyOn(service as any, 'validateDirectoryPath').mockReturnValue({ isValid: true });
    const result = await service.openInstanceDirectory('id');
    expect(result.success).toBe(true);
    expect(result.instanceId).toBe('id');
    expect(electron.shell.openPath).toHaveBeenCalled();
  });

  it('openInstanceDirectory fails security validation', async () => {
    jest.spyOn(validationUtils, 'validateInstanceId').mockReturnValue(true);
    jest.spyOn(instanceUtils, 'getInstance').mockResolvedValue({});
    jest.spyOn(service as any, 'validateDirectoryPath').mockReturnValue({ isValid: false, error: 'bad' });
    const result = await service.openInstanceDirectory('id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('bad');
  });

  it('getServerInstancesBaseDirectory returns correct path', () => {
    expect(service.getServerInstancesBaseDirectory()).toContain('AASMServer');
  });

  it('getConfigDirectory returns install dir', () => {
    expect(service.getConfigDirectory()).toBe('INSTALL_DIR');
  });

  it('testDirectoryAccess returns accessible for valid dir', async () => {
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ isDirectory: () => true } as any);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
    jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
    const result = await service.testDirectoryAccess('dir');
    expect(result.accessible).toBe(true);
  });

  it('testDirectoryAccess returns error for non-directory', async () => {
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ isDirectory: () => false } as any);
    const result = await service.testDirectoryAccess('dir');
    expect(result.accessible).toBe(false);
    expect(result.error).toBe('Path is not a directory');
  });

  it('testDirectoryAccess returns error for stat failure', async () => {
    jest.spyOn(fs.promises, 'stat').mockRejectedValue(new Error('fail'));
    const result = await service.testDirectoryAccess('dir');
    expect(result.accessible).toBe(false);
    expect(result.error).toBe('fail');
  });

  it('validateDirectoryPath returns valid for correct path', () => {
    const result = (service as any).validateDirectoryPath('INSTALL_DIR/AASMServer/ShooterGame/Saved/Servers/id');
    expect(result.isValid).toBe(true);
  });

  it('validateDirectoryPath returns invalid for traversal', () => {
    const result = (service as any).validateDirectoryPath('/etc/passwd');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('Access denied');
  });
});
