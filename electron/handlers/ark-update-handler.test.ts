import { messagingService } from '../services/messaging.service';
import type { ArkUpdateService } from '../services/ark-update.service';
import { setArkUpdateService } from './ark-update-handler';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/ark-update.service', () => ({ ArkUpdateService: jest.fn() }));
jest.mock('../utils/ark/ark-install.utils', () => ({ isArkServerInstalled: jest.fn(() => true) }));
jest.mock('../utils/ark/ark-server/ark-server-paths.utils', () => ({ getArkServerDir: jest.fn(() => '/ark') }));

const mockMessaging = jest.mocked(messagingService);
const service = { checkForUpdate: jest.fn(), refreshInstalledBuild: jest.fn() };

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('ark-update-handler', () => {
  const sender = { send: jest.fn() };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  function replies(channel: string): unknown[] {
    return mockMessaging.sendToOriginator.mock.calls.filter(([replyChannel]) => replyChannel === channel).map(call => call[1]);
  }

  describe('before main hands over the update service', () => {
    it('refuses to check for an update', async () => {
      await handlers['check-ark-update']({ requestId: 'r1' }, sender);

      expect(replies('check-ark-update')).toEqual([{ success: false, error: 'Update service not initialized', requestId: 'r1' }]);
    });

    it('reports the installation without build ids', async () => {
      await handlers['get-ark-installation']({ requestId: 'r1' }, sender);

      expect(replies('get-ark-installation')).toEqual([{
        success: true, installed: true, installedBuildId: null, latestBuildId: null,
        updateAvailable: false, lastCheckedAt: null, installPath: '/ark', requestId: 'r1'
      }]);
    });
  });

  describe('with the update service', () => {
    beforeAll(() => {
      setArkUpdateService(service as unknown as ArkUpdateService);
    });

    describe('check-ark-update', () => {
      it.each([
        ['no update', { success: true, hasUpdate: false, message: 'No update available' }],
        ['an update', { success: true, hasUpdate: true, buildId: '123456', message: 'New ARK server build available: 123456' }],
        ['a failed check', { success: false, hasUpdate: false, error: 'SteamCMD not available', message: 'Failed to check for ARK server updates' }]
      ])('replies with the result fields for %s', async (_label, result) => {
        service.checkForUpdate.mockResolvedValue(result);

        await handlers['check-ark-update']({ requestId: 'r1' }, sender);

        expect(replies('check-ark-update')).toEqual([{
          success: result.success,
          hasUpdate: result.hasUpdate,
          buildId: 'buildId' in result ? result.buildId : undefined,
          message: result.message,
          error: 'error' in result ? result.error : undefined,
          requestId: 'r1'
        }]);
      });

      it.each([
        ['an Error', new Error('Network error'), 'Network error'],
        ['a string', 'String error', 'String error']
      ])('replies a failure when the check throws %s', async (_label, thrown, error) => {
        service.checkForUpdate.mockRejectedValue(thrown);

        await handlers['check-ark-update']({ requestId: 'r1' }, sender);

        expect(replies('check-ark-update')).toEqual([{ success: false, error, requestId: 'r1' }]);
      });

      it('answers a request without a payload', async () => {
        service.checkForUpdate.mockResolvedValue({ success: true, hasUpdate: false, message: 'No update available' });

        await handlers['check-ark-update'](undefined, sender);

        expect(replies('check-ark-update')).toEqual([{
          success: true, hasUpdate: false, buildId: undefined, message: 'No update available', error: undefined, requestId: undefined
        }]);
      });
    });

    describe('get-ark-installation', () => {
      // The page must show one consistent picture: the installed build and the update flag
      // have to come from the same comparison, or a finished update still reads "Update available".
      it('reports the refreshed build and update flag together', async () => {
        service.refreshInstalledBuild.mockResolvedValue({
          installedBuildId: '25535041', latestBuildId: '25535041', updateAvailable: false, lastCheckedAt: 1790562909000
        });

        await handlers['get-ark-installation']({ requestId: 'r1' }, sender);

        expect(replies('get-ark-installation')).toEqual([{
          success: true, installed: true, installedBuildId: '25535041', latestBuildId: '25535041',
          updateAvailable: false, lastCheckedAt: 1790562909000, installPath: '/ark', requestId: 'r1'
        }]);
      });

      it('replies with the reason reading the build fails', async () => {
        service.refreshInstalledBuild.mockRejectedValue(new Error('steamapps unreadable'));

        await handlers['get-ark-installation']({ requestId: 'r1' }, sender);

        expect(replies('get-ark-installation')).toEqual([{ success: false, error: 'steamapps unreadable', requestId: 'r1' }]);
      });

      it('answers a request without a payload', async () => {
        service.refreshInstalledBuild.mockResolvedValue({
          installedBuildId: null, latestBuildId: null, updateAvailable: false, lastCheckedAt: null
        });

        await handlers['get-ark-installation'](undefined, sender);

        expect(replies('get-ark-installation')).toEqual([expect.objectContaining({ success: true, requestId: undefined })]);
      });
    });
  });
});
