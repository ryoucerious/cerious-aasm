import { messagingService } from '../services/messaging.service';
import { settingsService } from '../services/settings.service';
import { webServerService } from '../services/web-server.service';
import type { GlobalConfig } from '../utils/global-config.utils';

jest.mock('../services/messaging.service', () => ({
  messagingService: {
    on: jest.fn(),
    sendToOriginator: jest.fn(),
    sendToAll: jest.fn(),
    getApiProcess: jest.fn(),
  },
}));

jest.mock('../services/web-server.service', () => ({
  webServerService: { usesCommandLineLogin: jest.fn(() => false) },
}));

jest.mock('../services/settings.service', () => ({
  ...jest.requireActual('../services/settings.service'),
  settingsService: {
    getGlobalConfig: jest.fn(),
    updateGlobalConfig: jest.fn(),
    updateWebServerAuth: jest.fn(),
  },
}));

const mockMessaging = jest.mocked(messagingService);
const mockSettings = jest.mocked(settingsService);

const config: GlobalConfig = {
  startWebServerOnLoad: false,
  webServerPort: 3000,
  authenticationEnabled: true,
  authenticationUsername: 'admin',
  authenticationPassword: 'secret',
  maxBackupDownloadSizeMB: 100
};
const { authenticationPassword, ...withoutPassword } = config;
const shown = { ...withoutPassword, authenticationPasswordSet: true };

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('settings-handler', () => {
  const sender = { send: jest.fn() };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./settings-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  describe('get-global-config', () => {
    it('replies and broadcasts the config without the web password', async () => {
      mockSettings.getGlobalConfig.mockReturnValue(config);

      await handlers['get-global-config']({ requestId: 'r1' }, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-global-config', { ...shown, requestId: 'r1' }, sender);
      expect(mockMessaging.sendToAll).toHaveBeenCalledWith('global-config', shown);
      expect(JSON.stringify([...mockMessaging.sendToOriginator.mock.calls, ...mockMessaging.sendToAll.mock.calls])).not.toContain('secret');
    });

    it('answers a request without a payload', async () => {
      mockSettings.getGlobalConfig.mockReturnValue(config);

      await handlers['get-global-config'](undefined, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-global-config', { ...shown, requestId: undefined }, sender);
    });

    it.each([
      ['an Error', new Error('Failed to load config'), 'Failed to load config'],
      ['a string', 'String error', 'String error']
    ])('replies { error } without broadcasting when loading throws %s', async (_label, thrown, message) => {
      mockSettings.getGlobalConfig.mockImplementation(() => { throw thrown; });

      await handlers['get-global-config']({ requestId: 'r1' }, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-global-config', { error: message, requestId: 'r1' }, sender);
      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
    });
  });

  describe('set-global-config', () => {
    const child = { connected: true };

    beforeEach(() => {
      mockMessaging.getApiProcess.mockReturnValue(child as never);
    });

    it('saves, replies, updates the web login and broadcasts the config without the password', async () => {
      mockSettings.updateGlobalConfig.mockResolvedValue({ success: true, updatedConfig: config });

      await handlers['set-global-config']({ config: shown, requestId: 'r1' }, sender);

      expect(mockSettings.updateGlobalConfig).toHaveBeenCalledWith(shown, { canChangeLogin: true });
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'set-global-config', { success: true, error: undefined, requestId: 'r1' }, sender
      );
      expect(mockSettings.updateWebServerAuth).toHaveBeenCalledWith(config, child);
      expect(mockMessaging.sendToAll).toHaveBeenCalledWith('global-config', shown);
      expect(mockMessaging.sendToOriginator.mock.invocationCallOrder[0])
        .toBeLessThan(mockMessaging.sendToAll.mock.invocationCallOrder[0]);
    });

    it('leaves the web login alone while it comes from the command line', async () => {
      // A headless run's global config usually has authentication off; applying it would turn
      // off the login the operator started the server with.
      jest.mocked(webServerService.usesCommandLineLogin).mockReturnValueOnce(true);
      mockSettings.updateGlobalConfig.mockResolvedValue({ success: true, updatedConfig: { ...config, authenticationEnabled: false } });

      await handlers['set-global-config']({ config: shown, requestId: 'r1' }, sender);

      expect(mockSettings.updateWebServerAuth).not.toHaveBeenCalled();
      expect(mockMessaging.sendToAll).toHaveBeenCalledWith('global-config', expect.objectContaining({ authenticationEnabled: false }));
    });

    it('lets only an administrator change the web login', async () => {
      // The single web login signs in as Admin, so settings.manage alone must not reach it.
      mockSettings.updateGlobalConfig.mockResolvedValue({ success: false, error: 'not saved' });
      const webUser = (roleId: string) => ({
        type: 'api-process',
        authEnabled: true,
        user: { id: `${roleId}-user`, roleId, permissions: ['settings.manage'] },
        send: jest.fn()
      });

      await handlers['set-global-config']({ config: shown, requestId: 'r1' }, webUser('server-manager'));
      await handlers['set-global-config']({ config: shown, requestId: 'r2' }, webUser('admin'));

      expect(mockSettings.updateGlobalConfig.mock.calls).toEqual([
        [shown, { canChangeLogin: false }],
        [shown, { canChangeLogin: true }]
      ]);
    });

    it('passes on a missing config for the service to refuse', async () => {
      mockSettings.updateGlobalConfig.mockResolvedValue({ success: false, error: 'Invalid config object' });

      await handlers['set-global-config'](undefined, sender);

      expect(mockSettings.updateGlobalConfig).toHaveBeenCalledWith(undefined, { canChangeLogin: true });
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'set-global-config', { success: false, error: 'Invalid config object', requestId: undefined }, sender
      );
    });

    it('neither updates the login nor broadcasts when the save is refused', async () => {
      mockSettings.updateGlobalConfig.mockResolvedValue({ success: false, error: 'Invalid web server port' });

      await handlers['set-global-config']({ config: { webServerPort: 1 }, requestId: 'r1' }, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'set-global-config', { success: false, error: 'Invalid web server port', requestId: 'r1' }, sender
      );
      expect(mockSettings.updateWebServerAuth).not.toHaveBeenCalled();
      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
    });

    it.each([
      ['an Error', new Error('Database connection failed'), 'Database connection failed'],
      ['a string', 'String error', 'String error']
    ])('replies a failure when saving throws %s', async (_label, thrown, message) => {
      mockSettings.updateGlobalConfig.mockRejectedValue(thrown);

      await handlers['set-global-config']({ config: {}, requestId: 'r1' }, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'set-global-config', { success: false, error: message, requestId: 'r1' }, sender
      );
      expect(mockSettings.updateWebServerAuth).not.toHaveBeenCalled();
    });
  });
});
