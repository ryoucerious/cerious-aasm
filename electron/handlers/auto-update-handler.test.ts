import { messagingService } from '../services/messaging.service';
import { autoUpdateService } from '../services/auto-update.service';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/auto-update.service', () => ({
  autoUpdateService: {
    checkForUpdates: jest.fn(),
    getLastStatus: jest.fn(),
    isUpdateReady: jest.fn(),
    quitAndInstall: jest.fn(),
    downloadUpdate: jest.fn()
  }
}));

const mockMessaging = jest.mocked(messagingService);
const mockAutoUpdate = jest.mocked(autoUpdateService);

type Listener = (payload: unknown, sender: unknown) => Promise<void> | void;

describe('auto-update-handler', () => {
  const sender = { send: jest.fn() };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./auto-update-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  describe('check-for-app-update', () => {
    it('checks and replies without a requestId', async () => {
      mockAutoUpdate.checkForUpdates.mockResolvedValue(undefined);

      await handlers['check-for-app-update']({ requestId: 'r1' }, sender);

      expect(mockAutoUpdate.checkForUpdates).toHaveBeenCalled();
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('check-for-app-update', { success: true }, sender);
    });

    it.each([
      ['an Error', new Error('Network unavailable'), 'Network unavailable'],
      ['a string', 'string error', 'string error']
    ])('replies a failure when the check throws %s', async (_label, thrown, error) => {
      mockAutoUpdate.checkForUpdates.mockRejectedValue(thrown);

      await handlers['check-for-app-update']({}, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('check-for-app-update', { success: false, error }, sender);
    });

    it('answers a request without a payload', async () => {
      mockAutoUpdate.checkForUpdates.mockResolvedValue(undefined);

      await handlers['check-for-app-update'](undefined, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('check-for-app-update', { success: true }, sender);
    });
  });

  describe('get-app-update-status', () => {
    it('replies on app-update-status with the last status', async () => {
      const status = { status: 'available' as const, version: '2.0.0' };
      mockAutoUpdate.getLastStatus.mockReturnValue(status);

      await handlers['get-app-update-status'](undefined, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('app-update-status', status, sender);
    });

    it('says up to date before anything has happened', async () => {
      mockAutoUpdate.getLastStatus.mockReturnValue(null);

      await handlers['get-app-update-status']({}, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('app-update-status', { status: 'up-to-date' }, sender);
    });
  });

  describe('install-app-update', () => {
    it('refuses before an update has been downloaded', async () => {
      mockAutoUpdate.isUpdateReady.mockReturnValue(false);

      await handlers['install-app-update']({}, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'install-app-update', { success: false, error: 'No update has been downloaded yet.' }, sender
      );
      expect(mockAutoUpdate.quitAndInstall).not.toHaveBeenCalled();
    });

    it('replies, then restarts into the update a second later', async () => {
      jest.useFakeTimers();
      mockAutoUpdate.isUpdateReady.mockReturnValue(true);

      await handlers['install-app-update']({}, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('install-app-update', { success: true }, sender);
      jest.advanceTimersByTime(999);
      expect(mockAutoUpdate.quitAndInstall).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(mockAutoUpdate.quitAndInstall).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('replies a failure when the update state cannot be read', async () => {
      mockAutoUpdate.isUpdateReady.mockImplementation(() => { throw new Error('Internal error'); });

      await handlers['install-app-update'](undefined, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('install-app-update', { success: false, error: 'Internal error' }, sender);
    });
  });

  describe('download-app-update', () => {
    it('downloads and replies', async () => {
      mockAutoUpdate.downloadUpdate.mockResolvedValue(undefined);

      await handlers['download-app-update'](undefined, sender);

      expect(mockAutoUpdate.downloadUpdate).toHaveBeenCalled();
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('download-app-update', { success: true }, sender);
    });

    it('replies a failure when the download fails', async () => {
      mockAutoUpdate.downloadUpdate.mockRejectedValue(new Error('Disk full'));

      await handlers['download-app-update']({}, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('download-app-update', { success: false, error: 'Disk full' }, sender);
    });
  });
});
