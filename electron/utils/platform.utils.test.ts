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
  getProcessCpuSeconds,
  parseTasklistVerbose,
  parseDirFreeBytes,
  clearProcessStatsCache,
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
  execSync: jest.fn(),
  execFile: jest.fn()
}));

const mockExecSync = require('child_process').execSync as jest.Mock;
const mockExecFile = require('child_process').execFile as jest.Mock;

/** Make the next execFile call succeed with `stdout`. */
function mockExecFileStdout(stdout: string): void {
  mockExecFile.mockImplementation((_file: string, _args: string[], _options: object, callback: any) =>
    callback(null, stdout, '')
  );
}

/** Make the next execFile call fail. */
function mockExecFileFailure(error: Error): void {
  mockExecFile.mockImplementation((_file: string, _args: string[], _options: object, callback: any) =>
    callback(error)
  );
}

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

  describe('parseDirFreeBytes', () => {
    // Real `dir /-c C:\` tail, which is what every disk refresh parses once capacity is known.
    const englishOutput = [
      '09/07/2026  01:27 PM    <DIR>          XboxGames',
      '               3 File(s)         190744 bytes',
      '              13 Dir(s)    236041076736 bytes free'
    ].join('\r\n');

    it('should read free bytes from dir output', () => {
      expect(parseDirFreeBytes(englishOutput)).toBe(236041076736);
    });

    it('should work on localised Windows, where only the trailing text is translated', () => {
      const german = '              13 Verzeichnis(se), 236041076736 Bytes frei';
      expect(parseDirFreeBytes(german)).toBe(236041076736);
    });

    it('should ignore trailing blank lines', () => {
      expect(parseDirFreeBytes(englishOutput + '\r\n\r\n')).toBe(236041076736);
    });

    it('should return null when dir reported an error instead of a listing', () => {
      expect(parseDirFreeBytes('The system cannot find the path specified.')).toBeNull();
    });

    it('should return null for empty output', () => {
      expect(parseDirFreeBytes('   ')).toBeNull();
    });
  });

  describe('parseTasklistVerbose', () => {
    const row = '"ShooterGameServer.exe","1234","Console","1","15,234 K","Running","HOST\\user","0:02:03","N/A"';

    it('should read memory and CPU time from a verbose row', () => {
      expect(parseTasklistVerbose(row)).toEqual({ memoryMb: 15, cpuSeconds: 123 });
    });

    it('should tolerate a localised thousands separator in the memory field', () => {
      const german = '"ShooterGameServer.exe","1234","Console","1","15.234 K","Running","HOST\\user","0:00:00","N/A"';
      expect(parseTasklistVerbose(german)?.memoryMb).toBe(15);
    });

    it('should accumulate CPU hours past 24', () => {
      const longRunning = '"ShooterGameServer.exe","1234","Console","1","1 K","Running","HOST\\user","30:00:01","N/A"';
      expect(parseTasklistVerbose(longRunning)?.cpuSeconds).toBe(108001);
    });

    it('should return null when the process is gone', () => {
      expect(parseTasklistVerbose('INFO: No tasks are running which match the specified criteria.')).toBeNull();
    });

    it('should return null for a row missing the verbose columns', () => {
      expect(parseTasklistVerbose('"ShooterGameServer.exe","1234","Console","1","15,234 K"')).toBeNull();
    });
  });

  describe('getProcessMemoryUsage', () => {
    const verboseRow = '"ShooterGameServer.exe","1234","Console","1","15,234 K","Running","HOST\\user","0:02:03","N/A"';

    beforeEach(() => {
      mockExecSync.mockClear();
      mockExecFile.mockClear();
      clearProcessStatsCache();
    });

    describe('on Windows', () => {
      beforeEach(() => {
        (process as any).platform = 'win32';
      });

      it('should return memory usage in MB for valid Windows tasklist output', async () => {
        mockExecFileStdout(verboseRow);

        await expect(getProcessMemoryUsage(1234)).resolves.toBe(15); // 15,234 KB = 15 MB (rounded)
        expect(mockExecFile).toHaveBeenCalledWith(
          'tasklist',
          ['/FI', 'PID eq 1234', '/FO', 'CSV', '/NH', '/V'],
          expect.objectContaining({ windowsHide: true }),
          expect.any(Function)
        );
      });

      it('should not shell out to PowerShell', async () => {
        mockExecFileStdout(verboseRow);

        await getProcessMemoryUsage(1234);
        expect(mockExecFile.mock.calls[0][0]).toBe('tasklist');
        expect(mockExecSync).not.toHaveBeenCalled();
      });

      it('should reuse one lookup for the memory and CPU pollers', async () => {
        mockExecFileStdout(verboseRow);

        await expect(getProcessMemoryUsage(1234)).resolves.toBe(15);
        await expect(getProcessCpuSeconds(1234)).resolves.toBe(123);
        expect(mockExecFile).toHaveBeenCalledTimes(1);
      });

      it('should return null when process not found', async () => {
        mockExecFileStdout('INFO: No tasks are running which match the specified criteria.');

        await expect(getProcessMemoryUsage(9999)).resolves.toBeNull();
      });

      it('should return null when the command fails', async () => {
        mockExecFileFailure(new Error('Command failed'));

        await expect(getProcessMemoryUsage(1234)).resolves.toBeNull();
      });
    });

    describe('on Linux', () => {
      beforeEach(() => {
        (process as any).platform = 'linux';
      });

      it('should return null for Linux (memory monitoring not supported)', async () => {
        await expect(getProcessMemoryUsage(1234)).resolves.toBeNull();
        expect(mockExecFile).not.toHaveBeenCalled();
        expect(mockExecSync).not.toHaveBeenCalled();
      });

      it('should never invoke Windows tooling to read CPU time', async () => {
        // /proc/1234/stat does not exist on the test host, so this exercises the failure path
        // while proving no subprocess is spawned for it.
        await expect(getProcessCpuSeconds(1234)).resolves.toBeNull();
        expect(mockExecFile).not.toHaveBeenCalled();
      });
    });
  });
});
describe('Platform Utils - CPU sampling helpers', () => {
  const { cpuPercentFromSamples, processCpuPercent } = require('./platform.utils');

  it('cpuPercentFromSamples derives busy percentage from two aggregate samples', () => {
    expect(cpuPercentFromSamples({ idle: 100, total: 200 }, { idle: 150, total: 300 })).toBe(50);
    expect(cpuPercentFromSamples({ idle: 0, total: 0 }, { idle: 0, total: 100 })).toBe(100);
  });

  it('cpuPercentFromSamples returns 0 when no time elapsed', () => {
    expect(cpuPercentFromSamples({ idle: 5, total: 10 }, { idle: 5, total: 10 })).toBe(0);
  });

  it('processCpuPercent scales the delta by elapsed time and core count', () => {
    // 2 CPU-seconds over 10 wall seconds on 4 cores = 5%
    expect(processCpuPercent(10, 12, 10_000, 4)).toBe(5);
    // Saturating one core on a 2-core box = 50%
    expect(processCpuPercent(0, 10, 10_000, 2)).toBe(50);
  });

  it('processCpuPercent clamps to 0-100 and handles zero elapsed', () => {
    expect(processCpuPercent(5, 1, 1000, 1)).toBe(0);
    expect(processCpuPercent(0, 1000, 1000, 1)).toBe(100);
    expect(processCpuPercent(0, 1, 0, 1)).toBe(0);
  });
});
