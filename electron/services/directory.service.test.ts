import { DirectoryService } from './directory.service';
import * as platformUtils from '../utils/platform.utils';
import * as instanceUtils from '../utils/ark/instance.utils';
import { GlobalConfig, loadGlobalConfig } from '../utils/global-config.utils';
import * as electron from 'electron';
import * as fs from 'fs';

jest.mock('electron', () => ({
  shell: {
    openPath: jest.fn()
  }
}));
jest.mock('../utils/global-config.utils', () => ({ loadGlobalConfig: jest.fn() }));

describe('DirectoryService', () => {
  let service: DirectoryService;

  beforeEach(() => {
    service = new DirectoryService();
    jest.spyOn(platformUtils, 'getDefaultInstallDir').mockReturnValue('INSTALL_DIR');
    jest.mocked(loadGlobalConfig).mockReturnValue({ serverDataDir: '' } as GlobalConfig);
    (electron.shell.openPath as jest.Mock).mockResolvedValue('');
  });

  describe('openConfigDirectory', () => {
    it('opens the config dir', async () => {
      const result = await service.openConfigDirectory();

      expect(result).toEqual({ success: true, configDir: 'INSTALL_DIR' });
      expect(electron.shell.openPath).toHaveBeenCalledWith('INSTALL_DIR');
    });

    it('reports a failure to open it', async () => {
      (electron.shell.openPath as jest.Mock).mockRejectedValue(new Error('fail'));

      const result = await service.openConfigDirectory();

      expect(result).toEqual({ success: false, configDir: '', error: 'fail' });
    });

    // shell.openPath resolves with an error message rather than rejecting.
    it('reports the error shell.openPath resolves with', async () => {
      (electron.shell.openPath as jest.Mock).mockResolvedValue('Failed to open path');

      const result = await service.openConfigDirectory();

      expect(result).toEqual({ success: false, configDir: '', error: 'Failed to open path' });
    });
  });

  describe('openInstanceDirectory', () => {
    it('refuses an invalid instance id', async () => {
      const result = await service.openInstanceDirectory('../x');

      expect(result).toEqual({ success: false, error: 'Invalid instance ID' });
      expect(electron.shell.openPath).not.toHaveBeenCalled();
    });

    it('refuses a server that does not exist', async () => {
      jest.spyOn(instanceUtils, 'getInstance').mockReturnValue(null);

      const result = await service.openInstanceDirectory('a1');

      expect(result).toEqual({ success: false, error: 'Instance not found' });
      expect(electron.shell.openPath).not.toHaveBeenCalled();
    });

    it('opens the server folder', async () => {
      jest.spyOn(instanceUtils, 'getInstance').mockReturnValue({ id: 'a1' });

      const result = await service.openInstanceDirectory('a1');

      expect(result).toEqual({ success: true, instanceId: 'a1' });
      expect(electron.shell.openPath).toHaveBeenCalledWith('INSTALL_DIR/AASMServer/ShooterGame/Saved/Servers/a1');
    });

    // It used to check the folder against the default install dir, so every server under a
    // custom Server Data Directory was refused with "Access denied".
    it('opens the server folder under a custom Server Data Directory', async () => {
      jest.mocked(loadGlobalConfig).mockReturnValue({ serverDataDir: 'D:/ARK Data' } as GlobalConfig);
      jest.spyOn(instanceUtils, 'getInstance').mockReturnValue({ id: 'a1' });

      const result = await service.openInstanceDirectory('a1');

      expect(result).toEqual({ success: true, instanceId: 'a1' });
      expect(electron.shell.openPath).toHaveBeenCalledWith('D:/ARK Data/AASMServer/ShooterGame/Saved/Servers/a1');
    });

    it('reports the error shell.openPath resolves with', async () => {
      jest.spyOn(instanceUtils, 'getInstance').mockReturnValue({ id: 'a1' });
      (electron.shell.openPath as jest.Mock).mockResolvedValue('Failed to open path');

      const result = await service.openInstanceDirectory('a1');

      expect(result).toEqual({ success: false, error: 'Failed to open path' });
    });
  });

  describe('testDirectoryAccess', () => {
    it('returns accessible for a directory it can list and write', async () => {
      jest.mocked(fs.promises.stat).mockResolvedValue({ isDirectory: () => true } as fs.Stats);
      jest.mocked(fs.promises.readdir).mockResolvedValue([]);
      jest.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
      jest.mocked(fs.promises.unlink).mockResolvedValue(undefined);

      const result = await service.testDirectoryAccess('/srv/cluster');

      expect(result).toEqual({ accessible: true });
      expect(fs.promises.writeFile).toHaveBeenCalledWith('/srv/cluster/.cluster-test.tmp', 'test', 'utf8');
      expect(fs.promises.unlink).toHaveBeenCalledWith('/srv/cluster/.cluster-test.tmp');
    });

    it('resolves a relative path against the install dir, as the launch arguments do', async () => {
      jest.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'));

      await service.testDirectoryAccess('cluster');

      expect(fs.promises.stat).toHaveBeenCalledWith('INSTALL_DIR/cluster');
    });

    it('returns an error for a file', async () => {
      jest.mocked(fs.promises.stat).mockResolvedValue({ isDirectory: () => false } as fs.Stats);

      const result = await service.testDirectoryAccess('/srv/cluster');

      expect(result).toEqual({ accessible: false, error: 'Path is not a directory' });
    });

    it('returns the error when the path cannot be read', async () => {
      jest.mocked(fs.promises.stat).mockRejectedValue(new Error('fail'));

      const result = await service.testDirectoryAccess('/srv/cluster');

      expect(result).toEqual({ accessible: false, error: 'fail' });
    });

    it.each([undefined, '', '  ', 42])('refuses %p without touching the disk', async directoryPath => {
      const result = await service.testDirectoryAccess(directoryPath);

      expect(result).toEqual({ accessible: false, error: 'No directory given' });
      expect(fs.promises.stat).not.toHaveBeenCalled();
    });
  });
});
