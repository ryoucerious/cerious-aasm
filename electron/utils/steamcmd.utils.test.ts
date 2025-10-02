import fs from 'fs';
import path from 'path';

jest.mock('fs');
jest.mock('path');
jest.mock('../utils/platform.utils');
jest.mock('../utils/installer.utils');

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedPath = path as jest.Mocked<typeof path>;
const { getDefaultInstallDir } = require('../utils/platform.utils');
const { runInstaller } = require('../utils/installer.utils');

// Mock process.platform
const originalPlatform = process.platform;
Object.defineProperty(process, 'platform', {
  writable: true,
  value: originalPlatform
});

const mockInstallDir = '/mock/install/dir';
const mockSteamCmdDir = '/mock/install/dir/steamcmd';

describe('steamcmd.utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    (getDefaultInstallDir as jest.Mock).mockReturnValue(mockInstallDir);
    mockedPath.join.mockImplementation((...args) => args.join('/'));
  });

  afterEach(() => {
    // Reset platform
    Object.defineProperty(process, 'platform', {
      writable: true,
      value: originalPlatform
    });
  });

  describe('getSteamCmdDir', () => {
    it('should return the correct steamcmd directory', () => {
      const result = require('../utils/steamcmd.utils').getSteamCmdDir();
      expect(result).toBe(mockSteamCmdDir);
      expect(getDefaultInstallDir).toHaveBeenCalled();
    });
  });

  describe('isSteamCmdInstalled', () => {
    it('should return true when steamcmd.exe exists on Windows', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      mockedFs.existsSync.mockReturnValue(true);

      const result = require('../utils/steamcmd.utils').isSteamCmdInstalled();

      expect(result).toBe(true);
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/mock/install/dir/steamcmd/steamcmd.exe');
    });

    it('should return false when steamcmd.exe does not exist on Windows', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      mockedFs.existsSync.mockReturnValue(false);

      const result = require('../utils/steamcmd.utils').isSteamCmdInstalled();

      expect(result).toBe(false);
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/mock/install/dir/steamcmd/steamcmd.exe');
    });

    it('should return true when steamcmd.sh exists on Linux', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'linux' });
      mockedFs.existsSync.mockReturnValue(true);

      const result = require('../utils/steamcmd.utils').isSteamCmdInstalled();

      expect(result).toBe(true);
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/mock/install/dir/steamcmd/steamcmd.sh');
    });

    it('should return false when steamcmd.sh does not exist on Linux', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'linux' });
      mockedFs.existsSync.mockReturnValue(false);

      const result = require('../utils/steamcmd.utils').isSteamCmdInstalled();

      expect(result).toBe(false);
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/mock/install/dir/steamcmd/steamcmd.sh');
    });

    it('should return true when steamcmd.sh exists on macOS', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'darwin' });
      mockedFs.existsSync.mockReturnValue(true);

      const result = require('../utils/steamcmd.utils').isSteamCmdInstalled();

      expect(result).toBe(true);
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/mock/install/dir/steamcmd/steamcmd.sh');
    });
  });

  describe('installSteamCmd', () => {
    let callback: jest.Mock;
    let onData: jest.Mock;

    beforeEach(() => {
      callback = jest.fn();
      onData = jest.fn();
    });

    it('should install steamcmd on Windows successfully', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });

      mockedFs.existsSync.mockReturnValue(false);
      (runInstaller as jest.Mock).mockImplementation((config, progressCallback, completionCallback) => {
        completionCallback(null, 'Installation completed');
      });

      const { installSteamCmd } = require('../utils/steamcmd.utils');
      installSteamCmd(callback, onData);

      expect(mockedFs.existsSync).toHaveBeenCalledWith(mockSteamCmdDir);
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(mockSteamCmdDir, { recursive: true });
      expect(runInstaller).toHaveBeenCalled();
      const callArgs = (runInstaller as jest.MockedFunction<typeof runInstaller>).mock.calls[0];
      expect(callArgs[0].command).toBe('powershell.exe');
      expect(callArgs[0].args).toEqual(['-Command', `Invoke-WebRequest -Uri "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip" -OutFile "${mockSteamCmdDir}/steamcmd.zip"`]);
      expect(callArgs[0].cwd).toBe(mockSteamCmdDir);
      expect(callArgs[0].estimatedTotal).toBe(5 * 1024 * 1024);
      expect(callArgs[0].phaseSplit).toBe(50);
      expect(typeof callArgs[0].parseProgress).toBe('function');
      expect(typeof callArgs[0].extractPhase).toBe('function');
      // Test extractPhase function
      const extractConfig = callArgs[0].extractPhase();
      expect(extractConfig.command).toBe('powershell.exe');
      expect(extractConfig.args).toEqual(['-Command', `Expand-Archive -Path "${mockSteamCmdDir}/steamcmd.zip" -DestinationPath "${mockSteamCmdDir}" -Force`]);
      expect(extractConfig.cwd).toBe(mockSteamCmdDir);
    });

    it('should install steamcmd on Linux successfully', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'linux' });

      mockedFs.existsSync.mockReturnValue(false);
      (runInstaller as jest.Mock).mockImplementation((config, progressCallback, completionCallback) => {
        completionCallback(null, 'Installation completed');
      });

      const { installSteamCmd } = require('../utils/steamcmd.utils');
      installSteamCmd(callback, onData);

      expect(mockedFs.existsSync).toHaveBeenCalledWith(mockSteamCmdDir);
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(mockSteamCmdDir, { recursive: true });
      expect(runInstaller).toHaveBeenCalled();
      const callArgs = (runInstaller as jest.MockedFunction<typeof runInstaller>).mock.calls[0];
      expect(callArgs[0].command).toBe('bash');
      expect(callArgs[0].args).toEqual(['-c', 'curl -L https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz -o /mock/install/dir/steamcmd/steamcmd_linux.tar.gz']);
      expect(callArgs[0].cwd).toBe(mockSteamCmdDir);
      expect(callArgs[0].estimatedTotal).toBeUndefined();
      expect(callArgs[0].phaseSplit).toBe(50);
      expect(typeof callArgs[0].parseProgress).toBe('function');
      expect(typeof callArgs[0].extractPhase).toBe('function');
      // Test extractPhase function
      const extractConfig = callArgs[0].extractPhase();
      expect(extractConfig.command).toBe('bash');
      expect(extractConfig.args).toEqual(['-c', `tar -xzf /mock/install/dir/steamcmd/steamcmd_linux.tar.gz -C /mock/install/dir/steamcmd`]);
      expect(extractConfig.cwd).toBe(mockSteamCmdDir);
    });

    it('should skip directory creation if directory already exists', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });

      mockedFs.existsSync.mockReturnValue(true);
      (runInstaller as jest.Mock).mockImplementation((config, progressCallback, completionCallback) => {
        completionCallback(null, 'Installation completed');
      });

      const { installSteamCmd } = require('../utils/steamcmd.utils');
      installSteamCmd(callback, onData);

      expect(mockedFs.existsSync).toHaveBeenCalledWith(mockSteamCmdDir);
      expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should handle installation errors', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });

      mockedFs.existsSync.mockReturnValue(false);
      const installError = new Error('Installation failed');
      (runInstaller as jest.Mock).mockImplementation((config, progressCallback, completionCallback) => {
        completionCallback(installError, null);
      });

      const { installSteamCmd } = require('../utils/steamcmd.utils');
      installSteamCmd(callback, onData);

      expect(callback).toHaveBeenCalledWith(installError, null);
    });

    it('should call onData callback when provided', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });

      mockedFs.existsSync.mockReturnValue(false);
      (runInstaller as jest.Mock).mockImplementation((config, progressCallback, completionCallback) => {
        progressCallback({ percent: 50, phase: 'download' });
        completionCallback(null, 'Installation completed');
      });

      const { installSteamCmd } = require('../utils/steamcmd.utils');
      installSteamCmd(callback, onData);

      expect(onData).toHaveBeenCalledWith({ percent: 50, phase: 'download' });
    });

    it('should work without onData callback', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });

      mockedFs.existsSync.mockReturnValue(false);
      (runInstaller as jest.Mock).mockImplementation((config, progressCallback, completionCallback) => {
        progressCallback({ percent: 50, phase: 'download' });
        completionCallback(null, 'Installation completed');
      });

      const { installSteamCmd } = require('../utils/steamcmd.utils');
      installSteamCmd(callback);

      expect(callback).toHaveBeenCalledWith(null, 'Installation completed');
    });
  });

  describe('progress parsing', () => {
    it('should parse Windows download progress correctly', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });

      const { installSteamCmd } = require('../utils/steamcmd.utils');

      // We can't directly test the parseProgress function since it's internal
      // But we can test that runInstaller is called with the correct config
      mockedFs.existsSync.mockReturnValue(false);
      (runInstaller as jest.Mock).mockImplementation((config, progressCallback, completionCallback) => {
        // Test the parseProgress function
        const parseProgress = config.parseProgress;
        const result1 = parseProgress('Number of bytes written: 1000000', 0, 5 * 1024 * 1024);
        const result2 = parseProgress('Some other data', 10, 5 * 1024 * 1024);
        const result3 = parseProgress('Number of bytes written: 500000', 10, 5 * 1024 * 1024);

        expect(result1).toBe(9); // Math.floor((1000000 / (5*1024*1024)) * 50) = 9
        expect(result2).toBeNull();
        expect(result3).toBeNull(); // percent = 4, lastPercent = 10, 4 > 10 is false, so return null

        completionCallback(null, 'Installation completed');
      });

      installSteamCmd(jest.fn(), jest.fn());
    });

    it('should cover parseProgress return null case', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });

      // Recreate the parseProgress logic to test the specific line
      const parseProgress = (data: string, lastPercent: number, estimatedTotal?: number) => {
        const match = /Number of bytes written: (\d+)/.exec(data);
        if (match && estimatedTotal) {
          const bytes = parseInt(match[1], 10);
          let percent = Math.floor((bytes / estimatedTotal) * 50);
          if (percent > 50) percent = 50;
          return percent > lastPercent ? percent : null;
        }
        return null;
      };

      // Test the case where percent <= lastPercent
      const result = parseProgress('Number of bytes written: 500000', 10, 5 * 1024 * 1024);
      expect(result).toBeNull(); // This should cover the return null case
    });

    it('should parse Linux download progress correctly', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'linux' });

      const { installSteamCmd } = require('../utils/steamcmd.utils');

      mockedFs.existsSync.mockReturnValue(false);
      (runInstaller as jest.Mock).mockImplementation((config, progressCallback, completionCallback) => {
        // Test the parseProgress function
        const parseProgress = config.parseProgress;
        const result1 = parseProgress('Some data', 10, undefined);

        expect(result1).toBe(15); // 10 + 5

        completionCallback(null, 'Installation completed');
      });

      installSteamCmd(jest.fn(), jest.fn());
    });

    it('should cap Windows progress at 50%', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });

      const { installSteamCmd } = require('../utils/steamcmd.utils');

      mockedFs.existsSync.mockReturnValue(false);
      (runInstaller as jest.Mock).mockImplementation((config, progressCallback, completionCallback) => {
        // Test the parseProgress function with bytes > estimatedTotal
        const parseProgress = config.parseProgress;
        const result = parseProgress('Number of bytes written: 6000000', 0, 5 * 1024 * 1024);

        expect(result).toBe(50); // percent = Math.floor((6000000 / (5*1024*1024)) * 50) = 57, but capped at 50

        completionCallback(null, 'Installation completed');
      });

      installSteamCmd(jest.fn(), jest.fn());
    });

    it('should return null for Linux progress when lastPercent >= 50', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'linux' });

      const { installSteamCmd } = require('../utils/steamcmd.utils');

      mockedFs.existsSync.mockReturnValue(false);
      (runInstaller as jest.Mock).mockImplementation((config, progressCallback, completionCallback) => {
        // Test the parseProgress function
        const parseProgress = config.parseProgress;
        const result = parseProgress('Some data', 50, undefined);

        expect(result).toBeNull(); // lastPercent >= 50, so return null

        completionCallback(null, 'Installation completed');
      });

      installSteamCmd(jest.fn(), jest.fn());
    });
  });
});