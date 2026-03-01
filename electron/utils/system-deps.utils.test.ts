import { jest } from '@jest/globals';

// Mock dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('child_process');
jest.mock('./platform.utils');

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { getPlatform } from './platform.utils';

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedPath = path as jest.Mocked<typeof path>;
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockedGetPlatform = getPlatform as jest.MockedFunction<typeof getPlatform>;

// Import the module under test
import {
  LINUX_DEPENDENCIES,
  checkDependency,
  checkAllDependencies,
  getPackageNameForDistribution,
  generateInstallInstructions,
  getPackageManagerInfo,
  installMissingDependencies,
  validateSudoPassword,
  type LinuxDependency,
  type DependencyCheckResult,
  type LinuxDepsInstallProgress
} from './system-deps.utils';

describe('system-deps.utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset platform to linux for most tests
    mockedGetPlatform.mockReturnValue('linux');
  });

  describe('LINUX_DEPENDENCIES', () => {
    it('should contain all required dependencies', () => {
      expect(LINUX_DEPENDENCIES.length).toBe(6);
      expect(LINUX_DEPENDENCIES[0].name).toBe('cURL');
      expect(LINUX_DEPENDENCIES[1].name).toBe('Unzip');
      expect(LINUX_DEPENDENCIES[2].name).toBe('Tar');
      expect(LINUX_DEPENDENCIES[3].name).toBe('Xvfb');
      expect(LINUX_DEPENDENCIES[4].name).toBe('SteamCMD Dependencies (32-bit libraries)');
      expect(LINUX_DEPENDENCIES[5].name).toBe('Font Configuration');
    });

    it('should have correct structure for each dependency', () => {
      LINUX_DEPENDENCIES.forEach(dep => {
        expect(typeof dep.name).toBe('string');
        expect(dep.packageName).toBeDefined();
        expect(typeof dep.checkCommand).toBe('string');
        expect(typeof dep.description).toBe('string');
        expect(typeof dep.required).toBe('boolean');
      });
    });
  });

  describe('checkDependency', () => {
    let mockProc: any;

    beforeEach(() => {
      mockProc = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn()
      };
      mockedSpawn.mockReturnValue(mockProc as any);
    });

    it('should return installed true for non-linux platforms', async () => {
      mockedGetPlatform.mockReturnValue('windows');

      const result = await checkDependency(LINUX_DEPENDENCIES[0]);

      expect(result.installed).toBe(true);
      expect(result.version).toBe('N/A (not Linux)');
      expect(mockedSpawn).not.toHaveBeenCalled();
    });

    it('should return installed true when command succeeds', async () => {
      mockProc.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          callback(0); // Success code
        }
      });
      mockProc.stdout.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          callback('curl 7.68.0');
        }
      });

      const result = await checkDependency(LINUX_DEPENDENCIES[0]);

      expect(result.installed).toBe(true);
      expect(result.version).toBe('7.68.0');
      expect(mockedSpawn).toHaveBeenCalledWith('bash', ['-c', 'curl --version'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
    });

    it('should return installed false when command fails', async () => {
      mockProc.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          callback(1); // Failure code
        }
      });

      const result = await checkDependency(LINUX_DEPENDENCIES[0]);

      expect(result.installed).toBe(false);
      expect(result.version).toBeUndefined();
    });

    it('should handle timeout correctly', async () => {
      // Mock setTimeout to execute immediately
      jest.useFakeTimers();
      mockProc.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          // Don't call callback to simulate hanging process
        }
      });

      const promise = checkDependency(LINUX_DEPENDENCIES[0]);

      // Fast-forward time past the timeout
      jest.advanceTimersByTime(5000);

      const result = await promise;

      expect(result.installed).toBe(false);
      expect(mockProc.kill).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should extract version from first line when available', async () => {
      mockProc.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          callback(0);
        }
      });
      mockProc.stdout.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          callback('tar (GNU tar) 1.30\nCopyright (C) 2017 Free Software Foundation, Inc.');
        }
      });

      const result = await checkDependency(LINUX_DEPENDENCIES[2]); // Tar dependency

      expect(result.installed).toBe(true);
      expect(result.version).toBe('1.30');
    });
  });

  describe('checkAllDependencies', () => {
    it('should check all dependencies and return results', async () => {
      mockedGetPlatform.mockReturnValue('windows'); // Skip actual checks

      const results = await checkAllDependencies();

      expect(results.length).toBe(LINUX_DEPENDENCIES.length);
      results.forEach(result => {
        expect(result.dependency).toBeDefined();
        expect(result.installed).toBeDefined();
        expect(result.installed).toBe(true); // Non-linux returns true
      });
    });
  });

  describe('getPackageNameForDistribution', () => {
    beforeEach(() => {
      // Mock fs.existsSync for package manager detection
      mockedFs.existsSync.mockReturnValue(true);
    });

    it('should return string packageName directly', () => {
      const dep: LinuxDependency = {
        name: 'Test',
        packageName: 'test-package',
        checkCommand: 'test --version',
        description: 'Test package',
        required: true
      };

      const result = getPackageNameForDistribution(dep);
      expect(result).toBe('test-package');
    });

    it('should return apt package name when using apt', () => {
      const dep = LINUX_DEPENDENCIES[3]; // Xvfb with per-distro names
      const result = getPackageNameForDistribution(dep);
      expect(result).toBe('xvfb');
    });

    it('should return dnf package name when using dnf', () => {
      // Mock dnf as available, apt as not
      mockedFs.existsSync.mockImplementation((path) => String(path).includes('dnf'));

      const dep = LINUX_DEPENDENCIES[3]; // Xvfb
      const result = getPackageNameForDistribution(dep);
      expect(result).toBe('xorg-x11-server-Xvfb');
    });

    it('should fallback to first available package name when package manager not detected', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const dep = LINUX_DEPENDENCIES[3]; // Xvfb
      const result = getPackageNameForDistribution(dep);
      expect(result).toBe('xvfb'); // First in the object
    });
  });

  describe('generateInstallInstructions', () => {
    beforeEach(() => {
      mockedFs.existsSync.mockReturnValue(true);
    });

    it('should generate apt instructions', () => {
      const missingDeps = [LINUX_DEPENDENCIES[0], LINUX_DEPENDENCIES[1]];

      const instructions = generateInstallInstructions(missingDeps);

      expect(instructions).toContain('sudo apt-get update && sudo apt-get install curl unzip');
    });

    it('should generate dnf instructions', () => {
      mockedFs.existsSync.mockImplementation((path) => String(path).includes('dnf'));

      const missingDeps = [LINUX_DEPENDENCIES[0]];

      const instructions = generateInstallInstructions(missingDeps);

      expect(instructions).toContain('sudo dnf install curl');
      expect(instructions).toContain('RPM Fusion repositories');
    });

    it('should generate pacman instructions', () => {
      mockedFs.existsSync.mockImplementation((path) => String(path).includes('pacman'));

      const missingDeps = [LINUX_DEPENDENCIES[0]];

      const instructions = generateInstallInstructions(missingDeps);

      expect(instructions).toContain('sudo pacman -S curl');
    });

    it('should handle unknown package manager', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const missingDeps = [LINUX_DEPENDENCIES[0]];

      const instructions = generateInstallInstructions(missingDeps);

      expect(instructions).toContain('Could not detect package manager');
    });
  });

  describe('getPackageManagerInfo', () => {
    it('should return null for non-linux platforms', () => {
      mockedGetPlatform.mockReturnValue('windows');

      const result = getPackageManagerInfo();

      expect(result).toBeNull();
    });

    it('should detect apt package manager', () => {
      mockedFs.existsSync.mockImplementation((path) => (path as string).includes('apt'));

      const result = getPackageManagerInfo();

      expect(result).toEqual({
        manager: 'apt',
        installCmd: 'apt-get install -y',
        updateCmd: 'apt-get update'
      });
    });

    it('should detect dnf package manager', () => {
      mockedFs.existsSync.mockImplementation((path) => (path as string).includes('dnf'));

      const result = getPackageManagerInfo();

      expect(result).toEqual({
        manager: 'dnf',
        installCmd: 'dnf install -y',
        updateCmd: 'dnf makecache',
        installExtra: ''
      });
    });

    it('should detect pacman package manager', () => {
      mockedFs.existsSync.mockImplementation((path) => (path as string).includes('pacman'));

      const result = getPackageManagerInfo();

      expect(result).toEqual({
        manager: 'pacman',
        installCmd: 'pacman -S --noconfirm',
        updateCmd: 'pacman -Sy'
      });
    });

    it('should return null when no package manager detected', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = getPackageManagerInfo();

      expect(result).toBeNull();
    });
  });

  describe('installMissingDependencies', () => {
    let mockSudoProc: any;
    let mockProc: any;

    beforeEach(() => {
      mockProc = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn()
      };
      mockSudoProc = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { write: jest.fn(), end: jest.fn() },
        on: jest.fn(),
        kill: jest.fn()
      };
      // Mock spawn for both regular commands and sudo commands
      mockedSpawn.mockImplementation((...args: any[]) => {
        const command = args[0];
        if (command === 'sudo') {
          return mockSudoProc as any;
        }
        return mockProc as any;
      });
      mockedFs.existsSync.mockReturnValue(true);
    });

    it('should return success for non-linux platforms', async () => {
      mockedGetPlatform.mockReturnValue('windows');

      const result = await installMissingDependencies([], 'password', jest.fn());

      expect(result.success).toBe(true);
      expect(result.message).toContain('Not running on Linux');
    });

    it('should return success when no dependencies to install', async () => {
      const result = await installMissingDependencies([], 'password', jest.fn());

      expect(result.success).toBe(true);
      expect(result.message).toContain('All dependencies already installed');
    });

    it('should return failure when package manager not detected', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = await installMissingDependencies([LINUX_DEPENDENCIES[0]], 'password', jest.fn());

      expect(result.success).toBe(false);
      expect(result.message).toContain('Could not detect package manager');
    });

    it('should install dependencies successfully with apt', async () => {
      // Mock successful sudo commands
      mockSudoProc.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          callback(0); // Success
        }
      });

      const onProgress = jest.fn();
      const missingDeps = [LINUX_DEPENDENCIES[0]]; // curl

      const result = await installMissingDependencies(missingDeps, 'password', onProgress);

      expect(result.success).toBe(true);
      expect(result.message).toContain('All dependencies installed successfully');
      expect(onProgress).toHaveBeenCalled();
      expect(mockedSpawn.mock.calls.length).toBeGreaterThan(1); // Should have called sudo at least once
    });

    it('should handle installation failure for required dependency', async () => {
      // Mock failed sudo command
      mockSudoProc.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          callback(1); // Failure
        }
      });

      const onProgress = jest.fn();
      const missingDeps = [LINUX_DEPENDENCIES[0]]; // curl (required)

      const result = await installMissingDependencies(missingDeps, 'password', onProgress);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Dependency installation failed');
    });

    it('should continue with optional dependency failure', async () => {
      // Mock successful dpkg, update but failed install
      let callCount = 0;
      mockSudoProc.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          callCount++;
          if (callCount <= 2) {
            callback(0); // dpkg and update succeed
          } else {
            callback(1); // Install fails
          }
        }
      });

      const onProgress = jest.fn();
      const missingDeps = [LINUX_DEPENDENCIES[5]]; // Font Configuration (not required)

      const result = await installMissingDependencies(missingDeps, 'password', onProgress);

      expect(result.success).toBe(true); // Should succeed because Font Configuration is not required
      expect(result.details.some(detail => detail.includes('Failed to install'))).toBe(true);
    });

    it('should retry dnf installation with --allowerasing on failure', async () => {
      mockedFs.existsSync.mockImplementation((path) => String(path).includes('dnf'));
      
      // Mock successful update, failed first install, successful retry
      let callCount = 0;
      mockSudoProc.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          callCount++;
          if (callCount === 1) {
            callback(0); // Update succeeds
          } else if (callCount === 2) {
            callback(1); // First install fails
          } else {
            callback(0); // Retry succeeds
          }
        }
      });

      const onProgress = jest.fn();
      const missingDeps = [LINUX_DEPENDENCIES[0]]; // curl

      const result = await installMissingDependencies(missingDeps, 'password', onProgress);

      expect(result.success).toBe(true);
      expect(mockedSpawn.mock.calls.length).toBeGreaterThan(2); // Should have called update, install, and retry
    });
  });

  describe('validateSudoPassword', () => {
    let mockSudoProc: any;

    beforeEach(() => {
      mockSudoProc = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { write: jest.fn(), end: jest.fn() },
        on: jest.fn(),
        kill: jest.fn()
      };
      // Mock spawn for sudo commands
      mockedSpawn.mockImplementation((...args: any[]) => {
        const command = args[0];
        if (command === 'sudo') {
          return mockSudoProc as any;
        }
        return {} as any;
      });
    });

    it('should return true for valid sudo password', async () => {
      mockSudoProc.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          callback(0); // Success
        }
      });

      const result = await validateSudoPassword('correct-password');

      expect(result).toBe(true);
      expect(mockedSpawn.mock.calls.length).toBeGreaterThan(0);
    });

    it('should return false for invalid sudo password', async () => {
      mockSudoProc.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          callback(1); // Failure
        }
      });

      const result = await validateSudoPassword('wrong-password');

      expect(result).toBe(false);
    });
  });
});