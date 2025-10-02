import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import {
  getPlatform,
  isWindows,
  isLinux,
  getDefaultInstallDir,
  getUserDataPath,
  getHomeDir,
  getTempDir,
  getArchitecture,
  getTotalMemory,
  getFreeMemory,
  getProcessMemoryUsage,
  getCpuInfo,
  getUptime,
  getNetworkInterfaces,
  getEnvironmentPaths
} from '../utils/platform.utils';

// Mock dependencies
jest.mock('os');
jest.mock('path');
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn()
  }
}));

// Mock child_process module
jest.mock('child_process', () => ({
  execSync: jest.fn()
}));

const mockExecSync = require('child_process').execSync as jest.Mock;

const mockOs = os as jest.Mocked<typeof os>;
const mockPath = path as jest.Mocked<typeof path>;
const mockApp = app as jest.Mocked<typeof app>;

// Mock process.platform
const originalPlatform = process.platform;
Object.defineProperty(process, 'platform', {
  writable: true,
  value: originalPlatform
});

describe('Platform Utils', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Reset process.platform to original value
    (process as any).platform = originalPlatform;
  });

  describe('getPlatform', () => {
    it('should return "windows" for win32 platform', () => {
      (process as any).platform = 'win32';
      expect(getPlatform()).toBe('windows');
    });

    it('should return "linux" for linux platform', () => {
      (process as any).platform = 'linux';
      expect(getPlatform()).toBe('linux');
    });

    it('should throw error for unsupported platforms', () => {
      (process as any).platform = 'darwin';
      expect(() => getPlatform()).toThrow('Only Windows and Linux are supported. Current platform: darwin');
    });
  });

  describe('isWindows', () => {
    it('should return true when platform is windows', () => {
      (process as any).platform = 'win32';
      expect(isWindows()).toBe(true);
    });

    it('should return false when platform is not windows', () => {
      (process as any).platform = 'linux';
      expect(isWindows()).toBe(false);
    });
  });

  describe('isLinux', () => {
    it('should return true when platform is linux', () => {
      (process as any).platform = 'linux';
      expect(isLinux()).toBe(true);
    });

    it('should return false when platform is not linux', () => {
      (process as any).platform = 'win32';
      expect(isLinux()).toBe(false);
    });
  });

  describe('getDefaultInstallDir', () => {
    it('should return Windows path when on Windows', () => {
      (process as any).platform = 'win32';
      process.env.APPDATA = 'C:\\Users\\Test\\AppData\\Roaming';
      mockOs.homedir.mockReturnValue('C:\\Users\\Test');
      mockPath.join.mockReturnValue('C:\\Users\\Test\\AppData\\Roaming\\Cerious AASM');

      const result = getDefaultInstallDir();
      expect(result).toBe('C:\\Users\\Test\\AppData\\Roaming\\Cerious AASM');
      expect(mockPath.join).toHaveBeenCalledWith('C:\\Users\\Test\\AppData\\Roaming', 'Cerious AASM');
    });

    it('should return Linux path when on Linux', () => {
      (process as any).platform = 'linux';
      mockOs.homedir.mockReturnValue('/home/test');
      mockPath.join.mockReturnValue('/home/test/.local/share/cerious-aasm');

      const result = getDefaultInstallDir();
      expect(result).toBe('/home/test/.local/share/cerious-aasm');
      expect(mockPath.join).toHaveBeenCalledWith('/home/test', '.local', 'share', 'cerious-aasm');
    });

    it('should use homedir fallback when APPDATA is not set on Windows', () => {
      (process as any).platform = 'win32';
      delete process.env.APPDATA;
      mockOs.homedir.mockReturnValue('C:\\Users\\Test');
      mockPath.join.mockReturnValue('C:\\Users\\Test\\Cerious AASM');

      const result = getDefaultInstallDir();
      expect(result).toBe('C:\\Users\\Test\\Cerious AASM');
    });
  });

  describe('getUserDataPath', () => {
    it('should return Windows path when on Windows', () => {
      (process as any).platform = 'win32';
      mockApp.getPath.mockReturnValue('C:\\Users\\Test\\AppData\\Roaming');
      mockPath.join.mockReturnValue('C:\\Users\\Test\\AppData\\Roaming\\Cerious AASM');

      const result = getUserDataPath(mockApp);
      expect(result).toBe('C:\\Users\\Test\\AppData\\Roaming\\Cerious AASM');
      expect(mockApp.getPath).toHaveBeenCalledWith('appData');
    });

    it('should return Linux path when on Linux', () => {
      (process as any).platform = 'linux';
      mockOs.homedir.mockReturnValue('/home/test');
      mockPath.join.mockReturnValue('/home/test/.local/share/cerious-aasm');

      const result = getUserDataPath(mockApp);
      expect(result).toBe('/home/test/.local/share/cerious-aasm');
      expect(mockApp.getPath).not.toHaveBeenCalled();
    });
  });

  describe('getHomeDir', () => {
    it('should return the home directory', () => {
      mockOs.homedir.mockReturnValue('/home/test');
      expect(getHomeDir()).toBe('/home/test');
      expect(mockOs.homedir).toHaveBeenCalled();
    });
  });

  describe('getTempDir', () => {
    it('should return the temp directory', () => {
      mockOs.tmpdir.mockReturnValue('/tmp');
      expect(getTempDir()).toBe('/tmp');
      expect(mockOs.tmpdir).toHaveBeenCalled();
    });
  });

  describe('getArchitecture', () => {
    it('should return the system architecture', () => {
      mockOs.arch.mockReturnValue('x64');
      expect(getArchitecture()).toBe('x64');
      expect(mockOs.arch).toHaveBeenCalled();
    });
  });

  describe('getTotalMemory', () => {
    it('should return total system memory', () => {
      mockOs.totalmem.mockReturnValue(8589934592); // 8GB
      expect(getTotalMemory()).toBe(8589934592);
      expect(mockOs.totalmem).toHaveBeenCalled();
    });
  });

  describe('getFreeMemory', () => {
    it('should return free system memory', () => {
      mockOs.freemem.mockReturnValue(4294967296); // 4GB
      expect(getFreeMemory()).toBe(4294967296);
      expect(mockOs.freemem).toHaveBeenCalled();
    });
  });

  describe('getCpuInfo', () => {
    it('should return CPU information', () => {
      const mockCpus = [{ model: 'Intel Core i7', speed: 3200, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }];
      mockOs.cpus.mockReturnValue(mockCpus as any);

      const result = getCpuInfo();
      expect(result).toEqual(mockCpus);
      expect(mockOs.cpus).toHaveBeenCalled();
    });
  });

  describe('getUptime', () => {
    it('should return system uptime', () => {
      mockOs.uptime.mockReturnValue(3600); // 1 hour
      expect(getUptime()).toBe(3600);
      expect(mockOs.uptime).toHaveBeenCalled();
    });
  });

  describe('getNetworkInterfaces', () => {
    it('should return network interfaces', () => {
      const mockInterfaces = {
        eth0: [{ address: '192.168.1.100', family: 'IPv4', netmask: '255.255.255.0', mac: '00:00:00:00:00:00', internal: false, cidr: '192.168.1.100/24' }]
      };
      mockOs.networkInterfaces.mockReturnValue(mockInterfaces as any);

      const result = getNetworkInterfaces();
      expect(result).toEqual(mockInterfaces as any);
      expect(mockOs.networkInterfaces).toHaveBeenCalled();
    });
  });

  describe('getEnvironmentPaths', () => {
    it('should return all environment paths', () => {
      (process as any).platform = 'linux';
      mockOs.homedir.mockReturnValue('/home/test');
      mockOs.tmpdir.mockReturnValue('/tmp');
      mockOs.arch.mockReturnValue('x64');
      mockPath.join.mockReturnValue('/home/test/.local/share/cerious-aasm');

      const result = getEnvironmentPaths();

      expect(result).toEqual({
        home: '/home/test',
        temp: '/tmp',
        installDir: '/home/test/.local/share/cerious-aasm',
        platform: 'linux',
        arch: 'x64'
      });
    });
  });

  describe('getProcessMemoryUsage', () => {
    beforeEach(() => {
      mockExecSync.mockClear();
    });

    describe('on Windows', () => {
      beforeEach(() => {
        (process as any).platform = 'win32';
      });

      it('should return memory usage in MB for valid Windows tasklist output', () => {
        mockExecSync.mockReturnValue('"ShooterGameServer.exe","1234","Console","1","15,234 K"');

        const result = getProcessMemoryUsage(1234);
        expect(result).toBe(15); // 15,234 KB = 15 MB (rounded)
        expect(mockExecSync).toHaveBeenCalledWith('tasklist /FI "PID eq 1234" /FO CSV /NH', { encoding: 'utf8' });
      });

      it('should return null when process not found', () => {
        mockExecSync.mockReturnValue('INFO: No tasks are running which match the specified criteria.');

        const result = getProcessMemoryUsage(9999);
        expect(result).toBeNull();
      });

      it('should return null when execSync throws an error', () => {
        mockExecSync.mockImplementation(() => {
          throw new Error('Command failed');
        });

        const result = getProcessMemoryUsage(1234);
        expect(result).toBeNull();
      });
    });

    describe('on Linux', () => {
      beforeEach(() => {
        (process as any).platform = 'linux';
      });

      it('should return null for Linux (memory monitoring not supported)', () => {
        const result = getProcessMemoryUsage(1234);
        expect(result).toBeNull();
        expect(mockExecSync).not.toHaveBeenCalled();
      });

      it('should return null when ps command fails', () => {
        mockExecSync.mockImplementation(() => {
          throw new Error('Command failed');
        });

        const result = getProcessMemoryUsage(1234);
        expect(result).toBeNull();
      });
    });
  });
});