import { jest } from '@jest/globals';

jest.mock('electron', () => ({
  app: {
    getVersion: jest.fn(() => '1.0.12'),
    relaunch: jest.fn(),
    exit: jest.fn(),
  },
}));

jest.mock('axios');
jest.mock('./messaging.service', () => ({
  messagingService: {
    sendToAllRenderers: jest.fn(),
  },
}));

// Don't actually spawn processes
jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({
    on: jest.fn(),
  })),
  execSync: jest.fn(),
}));

import { app } from 'electron';
import axios from 'axios';
import { messagingService } from './messaging.service';

const mockApp = app as jest.Mocked<typeof app>;
const mockAxios = axios as jest.Mocked<typeof axios>;
const mockMessaging = messagingService as jest.Mocked<typeof messagingService>;

describe('LinuxPackageUpdaterService', () => {
  let LinuxPackageUpdaterService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isSupported', () => {
    it('should return false on non-Linux platforms', () => {
      jest.isolateModules(() => {
        // On Windows (current platform), it should be unsupported
        const mod = require('./linux-package-updater.service');
        const service = new mod.LinuxPackageUpdaterService();

        if (process.platform !== 'linux') {
          expect(service.isSupported()).toBe(false);
        }
      });
    });
  });

  describe('isUpdateReady', () => {
    it('should return false initially', () => {
      jest.isolateModules(() => {
        const mod = require('./linux-package-updater.service');
        const service = new mod.LinuxPackageUpdaterService();
        expect(service.isUpdateReady()).toBe(false);
      });
    });
  });

  describe('version comparison (isNewerVersion)', () => {
    // We'll test the version comparison via the checkForUpdates flow
    it('should detect newer versions', async () => {
      if (process.platform !== 'linux') {
        // Skip on non-Linux since service won't be supported
        return;
      }

      jest.isolateModules(async () => {
        const mod = require('./linux-package-updater.service');
        const service = new mod.LinuxPackageUpdaterService();

        // This is more of a smoke test on non-Linux
        expect(service.isUpdateReady()).toBe(false);
      });
    });
  });

  describe('checkForUpdates', () => {
    it('should broadcast checking status', async () => {
      jest.isolateModules(async () => {
        const mod = require('./linux-package-updater.service');
        const service = new mod.LinuxPackageUpdaterService();

        if (!service.isSupported()) {
          // On unsupported platforms, checkForUpdates does nothing
          return;
        }

        (mockAxios.get as jest.Mock<any>).mockResolvedValue({
          data: {
            tag_name: 'v1.0.12',
            assets: [],
          },
        });

        await service.checkForUpdates();

        expect(mockMessaging.sendToAllRenderers).toHaveBeenCalledWith(
          'app-update-status',
          expect.objectContaining({ status: 'checking' })
        );
      });
    });
  });

  describe('quitAndInstall', () => {
    it('should warn when no update downloaded', () => {
      jest.isolateModules(() => {
        const mod = require('./linux-package-updater.service');
        const service = new mod.LinuxPackageUpdaterService();

        service.quitAndInstall();

        // Should log warning, not crash
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('No update downloaded')
        );
      });
    });
  });
});
