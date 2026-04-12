import { jest } from '@jest/globals';

// Mock electron-updater
const mockAutoUpdater = {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  on: jest.fn(),
  checkForUpdates: jest.fn(),
  downloadUpdate: jest.fn(),
  quitAndInstall: jest.fn(),
};

jest.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}));

jest.mock('./messaging.service', () => ({
  messagingService: {
    sendToAllRenderers: jest.fn(),
  },
}));

jest.mock('./linux-package-updater.service', () => ({
  linuxPackageUpdaterService: {
    isSupported: jest.fn(() => false),
    checkForUpdates: jest.fn(),
    quitAndInstall: jest.fn(),
    isUpdateReady: jest.fn(() => false),
  },
}));

import { messagingService } from './messaging.service';
import { linuxPackageUpdaterService } from './linux-package-updater.service';

const mockMessaging = messagingService as jest.Mocked<typeof messagingService>;
const mockLinuxUpdater = linuxPackageUpdaterService as jest.Mocked<typeof linuxPackageUpdaterService>;

describe('AutoUpdateService', () => {
  let AutoUpdateService: any;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Force non-Linux platform so the constructor always takes the autoUpdater path.
    // On Linux (e.g. Docker) without APPIMAGE, the constructor would route to the
    // Linux package updater and skip autoUpdater setup entirely.
    Object.defineProperty(process, 'platform', { value: 'win32' });

    // Reset module cache so each test gets a fresh class
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original platform
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should disable auto-update in headless mode', () => {
      const origArgv = process.argv;
      process.argv = [...origArgv, '--headless'];

      // Re-require to trigger constructor with headless flag
      jest.isolateModules(() => {
        const mod = require('./auto-update.service');
        const service = new mod.AutoUpdateService();
        expect(service.isUpdateReady()).toBe(false);
      });

      process.argv = origArgv;
    });

    it('should set autoDownload to false', () => {
      jest.isolateModules(() => {
        require('./auto-update.service');
        // autoDownload should be set to false by the constructor
        expect(mockAutoUpdater.autoDownload).toBe(false);
      });
    });
  });

  describe('checkForUpdates', () => {
    it('should call electron-updater checkForUpdates', async () => {
      (mockAutoUpdater.checkForUpdates as jest.Mock<any>).mockResolvedValue(undefined);

      let serviceRef: any;
      jest.isolateModules(() => {
        serviceRef = require('./auto-update.service').autoUpdateService;
      });
      await serviceRef.checkForUpdates();
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalled();
    });

    it('should handle check errors gracefully', async () => {
      (mockAutoUpdater.checkForUpdates as jest.Mock<any>).mockRejectedValue(new Error('Network down'));

      let serviceRef: any;
      jest.isolateModules(() => {
        serviceRef = require('./auto-update.service').autoUpdateService;
      });
      // Should not throw
      await serviceRef.checkForUpdates();
    });
  });

  describe('downloadUpdate', () => {
    it('should call autoUpdater.downloadUpdate and broadcast status', async () => {
      (mockAutoUpdater.downloadUpdate as jest.Mock<any>).mockResolvedValue(undefined);

      let serviceRef: any;
      let localMessaging: any;
      jest.isolateModules(() => {
        localMessaging = require('./messaging.service').messagingService;
        serviceRef = require('./auto-update.service').autoUpdateService;
      });
      await serviceRef.downloadUpdate();
      expect(localMessaging.sendToAllRenderers).toHaveBeenCalledWith(
        'app-update-status',
        expect.objectContaining({ status: 'downloading', percent: 0 })
      );
    });
  });

  describe('getLastStatus', () => {
    it('should return null initially', () => {
      jest.isolateModules(() => {
        const { autoUpdateService } = require('./auto-update.service');
        expect(autoUpdateService.getLastStatus()).toBeNull();
      });
    });
  });

  describe('isUpdateReady', () => {
    it('should return false initially', () => {
      jest.isolateModules(() => {
        const { autoUpdateService } = require('./auto-update.service');
        expect(autoUpdateService.isUpdateReady()).toBe(false);
      });
    });
  });

  describe('quitAndInstall', () => {
    it('should not call autoUpdater.quitAndInstall when no update downloaded', () => {
      jest.isolateModules(() => {
        const { autoUpdateService } = require('./auto-update.service');
        autoUpdateService.quitAndInstall();
        expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
      });
    });
  });

  describe('event handlers', () => {
    it('should register event handlers with autoUpdater', () => {
      jest.isolateModules(() => {
        require('./auto-update.service');
        const eventNames = mockAutoUpdater.on.mock.calls.map((call: any[]) => call[0]);
        expect(eventNames).toContain('checking-for-update');
        expect(eventNames).toContain('update-available');
        expect(eventNames).toContain('update-not-available');
        expect(eventNames).toContain('download-progress');
        expect(eventNames).toContain('update-downloaded');
        expect(eventNames).toContain('error');
      });
    });

    it('should broadcast update-available when event fires', () => {
      jest.isolateModules(() => {
        const { messagingService: localMessaging } = require('./messaging.service');
        require('./auto-update.service');
        const updateAvailableHandler = mockAutoUpdater.on.mock.calls.find(
          (call: any[]) => call[0] === 'update-available'
        )?.[1];

        expect(updateAvailableHandler).toBeDefined();
        (updateAvailableHandler as Function)({ version: '2.0.0', releaseNotes: 'New stuff', releaseDate: '2024-01-01' });

        expect(localMessaging.sendToAllRenderers).toHaveBeenCalledWith(
          'app-update-status',
          expect.objectContaining({ status: 'available', version: '2.0.0' })
        );
      });
    });

    it('should broadcast update-not-available', () => {
      jest.isolateModules(() => {
        const { messagingService: localMessaging } = require('./messaging.service');
        require('./auto-update.service');
        const handler = mockAutoUpdater.on.mock.calls.find(
          (call: any[]) => call[0] === 'update-not-available'
        )?.[1];

        (handler as Function)({ version: '1.0.12' });

        expect(localMessaging.sendToAllRenderers).toHaveBeenCalledWith(
          'app-update-status',
          expect.objectContaining({ status: 'up-to-date', version: '1.0.12' })
        );
      });
    });

    it('should broadcast download progress', () => {
      jest.isolateModules(() => {
        const { messagingService: localMessaging } = require('./messaging.service');
        require('./auto-update.service');
        const handler = mockAutoUpdater.on.mock.calls.find(
          (call: any[]) => call[0] === 'download-progress'
        )?.[1];

        (handler as Function)({ percent: 50.5, bytesPerSecond: 1024, transferred: 512, total: 1024 });

        expect(localMessaging.sendToAllRenderers).toHaveBeenCalledWith(
          'app-update-status',
          expect.objectContaining({ status: 'downloading', percent: 50.5 })
        );
      });
    });

    it('should broadcast error events', () => {
      jest.isolateModules(() => {
        const { messagingService: localMessaging } = require('./messaging.service');
        require('./auto-update.service');
        const handler = mockAutoUpdater.on.mock.calls.find(
          (call: any[]) => call[0] === 'error'
        )?.[1];

        (handler as Function)(new Error('Update error'));

        expect(localMessaging.sendToAllRenderers).toHaveBeenCalledWith(
          'app-update-status',
          expect.objectContaining({ status: 'error', error: 'Update error' })
        );
      });
    });

    it('should set updateDownloaded flag when update-downloaded fires', () => {
      jest.isolateModules(() => {
        const { autoUpdateService } = require('./auto-update.service');
        const handler = mockAutoUpdater.on.mock.calls.find(
          (call: any[]) => call[0] === 'update-downloaded'
        )?.[1];

        expect(autoUpdateService.isUpdateReady()).toBe(false);
        (handler as Function)({ version: '2.0.0' });
        expect(autoUpdateService.isUpdateReady()).toBe(true);
      });
    });
  });

  describe('startPeriodicUpdateCheck', () => {
    it('should set up interval for periodic checks', () => {
      jest.useFakeTimers();

      jest.isolateModules(() => {
        const { autoUpdateService } = require('./auto-update.service');
        (mockAutoUpdater.checkForUpdates as jest.Mock<any>).mockResolvedValue(undefined);

        autoUpdateService.startPeriodicUpdateCheck(60000);

        jest.advanceTimersByTime(60000);
        expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalled();
      });

      jest.useRealTimers();
    });
  });
});
