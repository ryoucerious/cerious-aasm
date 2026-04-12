import { jest } from '@jest/globals';

jest.mock('../services/messaging.service', () => ({
  messagingService: {
    on: jest.fn(),
    sendToOriginator: jest.fn(),
    sendToAll: jest.fn(),
  },
}));

jest.mock('../services/auto-update.service', () => ({
  autoUpdateService: {
    checkForUpdates: jest.fn(),
    getLastStatus: jest.fn(),
    isUpdateReady: jest.fn(),
    quitAndInstall: jest.fn(),
    downloadUpdate: jest.fn(),
  },
}));

import { messagingService } from '../services/messaging.service';
import { autoUpdateService } from '../services/auto-update.service';

const mockMessaging = messagingService as jest.Mocked<typeof messagingService>;
const mockAutoUpdate = autoUpdateService as jest.Mocked<typeof autoUpdateService>;

describe('auto-update-handler', () => {
  let handlers: Record<string, (...args: any[]) => Promise<void>>;
  let mockSender: any;

  beforeAll(() => {
    require('./auto-update-handler');

    handlers = {};
    for (const call of (mockMessaging.on as jest.Mock<any>).mock.calls) {
      handlers[call[0] as string] = call[1] as any;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSender = { id: 'test-sender' };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should register all expected handlers', () => {
    expect(handlers['check-for-app-update']).toBeDefined();
    expect(handlers['get-app-update-status']).toBeDefined();
    expect(handlers['install-app-update']).toBeDefined();
    expect(handlers['download-app-update']).toBeDefined();
  });

  describe('check-for-app-update', () => {
    it('should check for updates successfully', async () => {
      (mockAutoUpdate.checkForUpdates as jest.Mock<any>).mockResolvedValue(undefined);

      await handlers['check-for-app-update']({}, mockSender);

      expect(mockAutoUpdate.checkForUpdates).toHaveBeenCalled();
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'check-for-app-update',
        { success: true },
        mockSender
      );
    });

    it('should handle check errors', async () => {
      (mockAutoUpdate.checkForUpdates as jest.Mock<any>).mockRejectedValue(new Error('Network unavailable'));

      await handlers['check-for-app-update']({}, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'check-for-app-update',
        { success: false, error: 'Network unavailable' },
        mockSender
      );
    });

    it('should handle non-Error rejections', async () => {
      (mockAutoUpdate.checkForUpdates as jest.Mock<any>).mockRejectedValue('string error');

      await handlers['check-for-app-update']({}, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'check-for-app-update',
        { success: false, error: 'string error' },
        mockSender
      );
    });
  });

  describe('get-app-update-status', () => {
    it('should return last status when available', () => {
      const status = { status: 'available', version: '2.0.0' };
      (mockAutoUpdate.getLastStatus as jest.Mock<any>).mockReturnValue(status);

      handlers['get-app-update-status']({}, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'app-update-status',
        status,
        mockSender
      );
    });

    it('should return up-to-date when no last status', () => {
      (mockAutoUpdate.getLastStatus as jest.Mock<any>).mockReturnValue(null);

      handlers['get-app-update-status']({}, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'app-update-status',
        { status: 'up-to-date' },
        mockSender
      );
    });
  });

  describe('install-app-update', () => {
    it('should fail if no update is ready', async () => {
      (mockAutoUpdate.isUpdateReady as jest.Mock<any>).mockReturnValue(false);

      await handlers['install-app-update']({}, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'install-app-update',
        { success: false, error: 'No update has been downloaded yet.' },
        mockSender
      );
      expect(mockAutoUpdate.quitAndInstall).not.toHaveBeenCalled();
    });

    it('should send success and schedule quit when update is ready', async () => {
      jest.useFakeTimers();
      (mockAutoUpdate.isUpdateReady as jest.Mock<any>).mockReturnValue(true);

      await handlers['install-app-update']({}, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'install-app-update',
        { success: true },
        mockSender
      );

      // quitAndInstall should be called after setTimeout
      jest.advanceTimersByTime(1000);
      expect(mockAutoUpdate.quitAndInstall).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should handle errors during install', async () => {
      (mockAutoUpdate.isUpdateReady as jest.Mock<any>).mockImplementation(() => {
        throw new Error('Internal error');
      });

      await handlers['install-app-update']({}, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'install-app-update',
        { success: false, error: 'Internal error' },
        mockSender
      );
    });
  });

  describe('download-app-update', () => {
    it('should download update successfully', async () => {
      (mockAutoUpdate.downloadUpdate as jest.Mock<any>).mockResolvedValue(undefined);

      await handlers['download-app-update']({}, mockSender);

      expect(mockAutoUpdate.downloadUpdate).toHaveBeenCalled();
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'download-app-update',
        { success: true },
        mockSender
      );
    });

    it('should handle download errors', async () => {
      (mockAutoUpdate.downloadUpdate as jest.Mock<any>).mockRejectedValue(new Error('Disk full'));

      await handlers['download-app-update']({}, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'download-app-update',
        { success: false, error: 'Disk full' },
        mockSender
      );
    });
  });
});
