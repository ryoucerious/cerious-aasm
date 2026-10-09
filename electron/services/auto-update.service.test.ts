import { jest } from '@jest/globals';

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

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
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

describe('AutoUpdateService', () => {
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

    jest.resetModules();
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('reports a newer release in headless mode without installing it', async () => {
      const origArgv = process.argv;
      const origDocker = process.env.AASM_DOCKER;
      process.argv = [...origArgv, '--headless'];
      process.env.AASM_DOCKER = '1';

      await jest.isolateModulesAsync(async () => {
        const axios = require('axios').default;
        const { app } = require('electron');
        // Unpackaged Electron reports its own runtime version. The check must
        // use the app version from package.json instead.
        app.getVersion.mockReturnValue('21.4.4');
        app.isPackaged = false;
        axios.get.mockResolvedValue({ data: { tag_name: 'v9.0.0', body: 'notes', published_at: '2026-01-01' } });
        const mod = require('./auto-update.service');
        const { messagingService: bus } = require('./messaging.service');
        const service = new mod.AutoUpdateService();
        await service.checkForUpdates();
        expect(service.isUpdateReady()).toBe(false);
        expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled();
        expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
        expect(bus.sendToAllRenderers).toHaveBeenCalledWith('app-update-status', expect.objectContaining({
          status: 'available',
          version: '9.0.0',
          manual: true,
        }));
        const payload = bus.sendToAllRenderers.mock.calls.find((call: any[]) => call[1]?.status === 'available')[1];
        expect(payload.instructions).toContain('docker compose pull');
      });

      process.argv = origArgv;
      if (origDocker === undefined) delete process.env.AASM_DOCKER;
      else process.env.AASM_DOCKER = origDocker;
    });

    async function inHeadlessMode(run: () => Promise<void>): Promise<void> {
      const origArgv = process.argv;
      process.argv = [...origArgv, '--headless'];
      try {
        await jest.isolateModulesAsync(run);
      } finally {
        process.argv = origArgv;
      }
    }

    it('in headless mode, offers the release of the pre-release it runs', async () => {
      await inHeadlessMode(async () => {
        const { app } = require('electron');
        app.getVersion.mockReturnValue('1.2.0-beta.1');
        app.isPackaged = true;
        require('axios').default.get.mockResolvedValue({ data: { tag_name: 'v1.2.0', body: 'notes', published_at: '2026-01-01', assets: [] } });
        const { messagingService: bus } = require('./messaging.service');
        const service = new (require('./auto-update.service').AutoUpdateService)();

        await service.checkForUpdates();

        expect(bus.sendToAllRenderers).toHaveBeenLastCalledWith('app-update-status', expect.objectContaining({
          status: 'available',
          version: '1.2.0',
          instructionsUrl: 'https://github.com/ryoucerious/cerious-aasm/releases/latest'
        }));
      });
    });

    it('in headless mode, reports a release it cannot fetch', async () => {
      await inHeadlessMode(async () => {
        require('axios').default.get.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
        const { messagingService: bus } = require('./messaging.service');
        const service = new (require('./auto-update.service').AutoUpdateService)();

        await service.checkForUpdates();

        expect(bus.sendToAllRenderers).toHaveBeenLastCalledWith('app-update-status', { status: 'error', error: 'Could not check for an update.' });
      });
    });

    it('should set autoDownload to false', () => {
      jest.isolateModules(() => {
        require('./auto-update.service');
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
      await serviceRef.checkForUpdates();
    });
  });

  describe('downloadUpdate', () => {
    it('should call autoUpdater.downloadUpdate and broadcast status', async () => {
      (mockAutoUpdater.downloadUpdate as jest.Mock<any>).mockResolvedValue(undefined);

      let serviceRef: any;
      let localMessaging!: jest.Mocked<typeof messagingService>;
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

    // A machine in a mesh is often unattended, and the installer's wizard waited there for someone to click Next.
    it('installs a downloaded update without the wizard, then starts the app again', () => {
      jest.isolateModules(() => {
        const { autoUpdateService } = require('./auto-update.service');
        const downloaded = mockAutoUpdater.on.mock.calls.filter((call: any[]) => call[0] === 'update-downloaded').pop()?.[1];
        (downloaded as Function)({ version: '2.0.0' });

        autoUpdateService.quitAndInstall();

        expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
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

  describe('simulateUpdateLifecycleForDev', () => {
    it('plays a check, a ten-step download and a finished update to the renderers', () => {
      jest.useFakeTimers();
      let localMessaging!: jest.Mocked<typeof messagingService>;
      jest.isolateModules(() => {
        localMessaging = require('./messaging.service').messagingService;
        require('./auto-update.service').autoUpdateService.simulateUpdateLifecycleForDev();
      });
      const statuses = () => localMessaging.sendToAllRenderers.mock.calls.map(([, data]) => (data as { status: string }).status);

      jest.advanceTimersByTime(1999);
      expect(statuses()).toEqual([]);

      jest.advanceTimersByTime(1);
      expect(statuses()).toEqual(['checking']);

      jest.advanceTimersByTime(10000);
      expect(statuses()).toEqual(['checking', 'available', ...Array(10).fill('downloading'), 'downloaded']);
      expect(localMessaging.sendToAllRenderers).toHaveBeenCalledWith('app-update-status', expect.objectContaining({ status: 'downloading', percent: 100 }));
      expect(localMessaging.sendToAllRenderers).toHaveBeenLastCalledWith('app-update-status', expect.objectContaining({ status: 'downloaded', version: '99.0.0' }));
      expect(localMessaging.sendToAllRenderers.mock.calls.every(([channel]) => channel === 'app-update-status')).toBe(true);

      jest.useRealTimers();
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

    it('keeps a single timer, which never holds the process open', () => {
      jest.useFakeTimers();

      jest.isolateModules(() => {
        const { autoUpdateService } = require('./auto-update.service');
        const setIntervalSpy = jest.spyOn(global, 'setInterval');

        autoUpdateService.startPeriodicUpdateCheck(60000);
        autoUpdateService.startPeriodicUpdateCheck(60000);

        expect(jest.getTimerCount()).toBe(1);
        expect(setIntervalSpy.mock.results.map(result => (result.value as NodeJS.Timeout).hasRef())).not.toContain(true);
      });

      jest.useRealTimers();
    });
  });
});
