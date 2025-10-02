import { jest } from '@jest/globals';

// Mock dependencies
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  chmodSync: jest.fn(),
  accessSync: jest.fn(),
  constants: {
    W_OK: 2,
    R_OK: 4,
  },
}));
jest.mock('path');
jest.mock('os');
jest.mock('./platform.utils');
jest.mock('./installer.utils');

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDefaultInstallDir } from './platform.utils';
import { runInstaller } from './installer.utils';

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedPath = path as jest.Mocked<typeof path>;
const mockedOs = os as jest.Mocked<typeof os>;
const mockedGetDefaultInstallDir = getDefaultInstallDir as jest.MockedFunction<typeof getDefaultInstallDir>;
const mockedRunInstaller = runInstaller as jest.MockedFunction<typeof runInstaller>;

// Import the module under test
import {
  getProtonDir,
  isProtonInstalled,
  getProtonBinaryPath,
  installProton,
  ensureProtonPrefixExists
} from './proton.utils';

describe('proton.utils', () => {
  const mockInstallDir = '/mock/install/dir';
  const mockHomeDir = '/mock/home';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock console.warn to suppress expected warnings from file permission tests
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    
    process.env.HOME = mockHomeDir;
    mockedGetDefaultInstallDir.mockReturnValue(mockInstallDir);
    mockedOs.homedir.mockReturnValue(mockHomeDir);
    mockedPath.join.mockImplementation((...args) => args.join('/'));
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockReturnValue(undefined);
    // Note: chmodSync and accessSync may not be available in all fs mock implementations
  });

  describe('getProtonDir', () => {
    it('should return the correct proton directory', () => {
      const result = getProtonDir();
      expect(mockedGetDefaultInstallDir).toHaveBeenCalled();
      expect(result).toBe(`${mockInstallDir}/proton`);
    });
  });

  describe('isProtonInstalled', () => {
    it('should return false when proton binary does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = isProtonInstalled();

      expect(result).toBe(false);
      expect(mockedFs.existsSync).toHaveBeenCalledWith(`${mockInstallDir}/proton/proton`);
      expect(mockedFs.existsSync).toHaveBeenCalledWith(`${mockInstallDir}/proton/dist/bin/proton`);
    });

    it('should return false when proton binary exists but required directories do not', () => {
      mockedFs.existsSync
        .mockReturnValueOnce(true) // proton binary exists
        .mockReturnValue(false); // required directories don't exist

      const result = isProtonInstalled();

      expect(result).toBe(false);
      expect(mockedFs.existsSync).toHaveBeenCalledTimes(2); // binary + first required dir (short-circuits on false)
    });

    it('should return true when proton binary and all required directories exist', () => {
      mockedFs.existsSync.mockReturnValue(true);

      const result = isProtonInstalled();

      expect(result).toBe(true);
      expect(mockedFs.existsSync).toHaveBeenCalledTimes(5); // binary + 4 required dirs
    });

    it('should check all required directories', () => {
      mockedFs.existsSync.mockReturnValue(true);

      isProtonInstalled();

      expect(mockedFs.existsSync).toHaveBeenCalledWith(`${mockInstallDir}/.wine-ark`);
      expect(mockedFs.existsSync).toHaveBeenCalledWith(`${mockInstallDir}/.steam-compat`);
      expect(mockedFs.existsSync).toHaveBeenCalledWith(`${mockInstallDir}/.steam`);
      expect(mockedFs.existsSync).toHaveBeenCalledWith(`${mockHomeDir}/.config/protonfixes`);
    });
  });

  describe('getProtonBinaryPath', () => {
    it('should return proton binary path when it exists', () => {
      mockedFs.existsSync
        .mockReturnValueOnce(true) // proton binary exists
        .mockReturnValueOnce(false); // dist binary doesn't

      const result = getProtonBinaryPath();

      expect(result).toBe(`${mockInstallDir}/proton/proton`);
    });

    it('should return dist proton binary path when direct binary does not exist', () => {
      mockedFs.existsSync.mockImplementation((path) => {
        if (path === `${mockInstallDir}/proton/proton`) return false;
        if (path === `${mockInstallDir}/proton/dist/bin/proton`) return true;
        return false;
      });

      const result = getProtonBinaryPath();

      expect(result).toBe(`${mockInstallDir}/proton/dist/bin/proton`);
    });

    it('should throw error when neither binary exists', () => {
      mockedFs.existsSync.mockReturnValue(false);

      expect(() => getProtonBinaryPath()).toThrow('Proton binary not found. Please install Proton first.');
    });
  });

  describe('installProton', () => {
    let callback: jest.Mock;
    let onData: jest.Mock;

    beforeEach(() => {
      callback = jest.fn();
      onData = jest.fn();
      mockedRunInstaller.mockImplementation((config, progressCallback, completionCallback) => {
        completionCallback(null, 'Installation completed');
      });
    });

    it('should create proton directory if it does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      installProton(callback, onData);

      expect(mockedFs.existsSync).toHaveBeenCalledWith(`${mockInstallDir}/proton`);
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(`${mockInstallDir}/proton`, { recursive: true });
    });

    it('should not create proton directory if it already exists', () => {
      mockedFs.existsSync.mockReturnValue(true);

      installProton(callback, onData);

      expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should call runInstaller with correct configuration', () => {
      installProton(callback, onData);

      expect(mockedRunInstaller).toHaveBeenCalledTimes(1);
      const callArgs = mockedRunInstaller.mock.calls[0];
      expect(callArgs[0].command).toBe('bash');
      expect(callArgs[0].args).toEqual(['-c', 'curl -L "https://github.com/GloriousEggroll/proton-ge-custom/releases/download/GE-Proton10-15/GE-Proton10-15.tar.gz" -o "/mock/install/dir/proton/GE-Proton10-15.tar.gz"']);
      expect(callArgs[0].cwd).toBe(`${mockInstallDir}/proton`);
      expect(callArgs[0].phaseSplit).toBe(50);
      expect(typeof callArgs[0].parseProgress).toBe('function');
      expect(typeof callArgs[0].extractPhase).toBe('function');
      expect(typeof callArgs[1]).toBe('function'); // progress callback
      expect(typeof callArgs[2]).toBe('function'); // completion callback
    });

    it('should make proton binary executable after successful installation', () => {
      mockedFs.existsSync.mockReturnValue(true);

      installProton(callback, onData);

      // Wait for the completion callback to be called
      const completionCallback = mockedRunInstaller.mock.calls[0][2];
      completionCallback(null, 'Installation completed');

      expect(mockedFs.chmodSync).toHaveBeenCalledWith(`${mockInstallDir}/proton/proton`, '755');
    });

    it('should create all required directories after successful installation', () => {
      mockedFs.existsSync.mockReturnValue(false);

      installProton(callback, onData);

      // Wait for the completion callback to be called
      const completionCallback = mockedRunInstaller.mock.calls[0][2];
      completionCallback(null, 'Installation completed');

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(`${mockInstallDir}/.wine-ark`, { recursive: true });
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(`${mockInstallDir}/.steam-compat`, { recursive: true });
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(`${mockInstallDir}/.steam`, { recursive: true });
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(`${mockHomeDir}/.config/protonfixes`, { recursive: true });
    });

    it('should not create directories that already exist', () => {
      mockedFs.existsSync.mockReturnValue(true);

      installProton(callback, onData);

      // Wait for the completion callback to be called
      const completionCallback = mockedRunInstaller.mock.calls[0][2];
      completionCallback(null, 'Installation completed');

      // Should not call mkdirSync since all directories already exist
      expect(mockedFs.mkdirSync).toHaveBeenCalledTimes(0);
    });

    it('should call onData callback when provided and progress is made', () => {
      installProton(callback, onData);

      const progressCallback = mockedRunInstaller.mock.calls[0][1];
      progressCallback({ step: 'download', message: 'Downloading', percent: 25 });

      expect(onData).toHaveBeenCalledWith(JSON.stringify({ step: 'download', message: 'Downloading', percent: 25 }));
    });

    it('should not call onData callback when not provided', () => {
      installProton(callback);

      const progressCallback = mockedRunInstaller.mock.calls[0][1];
      progressCallback({ step: 'download', message: 'Downloading', percent: 25 });

      expect(onData).not.toHaveBeenCalled();
    });

    it('should call callback with error when installation fails', () => {
      const installError = new Error('Installation failed');
      mockedRunInstaller.mockImplementation((config, progressCallback, completionCallback) => {
        completionCallback(installError, undefined);
      });

      installProton(callback, onData);

      expect(callback).toHaveBeenCalledWith(installError, undefined);
      expect(mockedFs.chmodSync).not.toHaveBeenCalled();
    });

    it('should call callback with success when installation completes', () => {
      installProton(callback, onData);

      // Wait for the completion callback to be called
      const completionCallback = mockedRunInstaller.mock.calls[0][2];
      completionCallback(null, 'Installation completed');

      expect(callback).toHaveBeenCalledWith(null, 'Installation completed');
    });

    it('should handle chmod errors gracefully', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.chmodSync.mockImplementation(() => {
        throw new Error('chmod failed');
      });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      installProton(callback, onData);

      // Wait for the completion callback to be called
      const completionCallback = mockedRunInstaller.mock.calls[0][2];
      completionCallback(null, 'Installation completed');

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should handle directory creation errors gracefully', () => {
      mockedFs.existsSync.mockImplementation((path) => {
        if (path === `${mockInstallDir}/proton`) return true; // proton dir exists
        return false; // required dirs don't
      });
      mockedFs.mkdirSync.mockImplementation(() => {
        throw new Error('mkdir failed');
      });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      installProton(callback, onData);

      // Wait for the completion callback to be called
      const completionCallback = mockedRunInstaller.mock.calls[0][2];
      completionCallback(null, 'Installation completed');

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('ensureProtonPrefixExists', () => {
    it('should create proton-prefix directory if it does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      ensureProtonPrefixExists();

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(`${mockInstallDir}/proton-prefix`, { recursive: true });
    });

    it('should create all required directories if they do not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      ensureProtonPrefixExists();

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(`${mockInstallDir}/.wine-ark`, { recursive: true });
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(`${mockInstallDir}/.steam-compat`, { recursive: true });
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(`${mockInstallDir}/.steam`, { recursive: true });
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(`${mockHomeDir}/.config/protonfixes`, { recursive: true });
    });

    it('should not create directories that already exist', () => {
      mockedFs.existsSync.mockReturnValue(true);

      ensureProtonPrefixExists();

      expect(mockedFs.mkdirSync).toHaveBeenCalledTimes(0); // No directories created since all exist
    });

    it('should set correct permissions on proton-prefix when not writable', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.accessSync.mockImplementation(() => {
        throw new Error('not writable');
      });

      ensureProtonPrefixExists();

      expect(mockedFs.chmodSync).toHaveBeenCalledWith(`${mockInstallDir}/proton-prefix`, 0o700);
    });

    it('should handle access check errors gracefully', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.accessSync.mockImplementation(() => {
        throw new Error('access failed');
      });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      ensureProtonPrefixExists();

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should handle chmod errors gracefully', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.accessSync.mockImplementation(() => {
        throw new Error('not writable');
      });
      mockedFs.chmodSync.mockImplementation(() => {
        throw new Error('chmod failed');
      });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      ensureProtonPrefixExists();

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should handle mkdir errors gracefully', () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.mkdirSync.mockImplementation(() => {
        throw new Error('mkdir failed');
      });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      ensureProtonPrefixExists();

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });
});