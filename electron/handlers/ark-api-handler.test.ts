import { messagingService } from '../services/messaging.service';
import { arkApiPluginService } from '../services/ark-api-plugin.service';
import { isAsaApiLoaderInstalled } from '../utils/ark/ark-server/ark-server-paths.utils';
import { meshService } from '../services/mesh/mesh-service';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/ark-api-plugin.service', () => ({
  arkApiPluginService: {
    listPlugins: jest.fn(),
    removePlugin: jest.fn(),
    getLatestAsaApiRelease: jest.fn(),
    downloadAsaApi: jest.fn(),
    readZipAsBase64: jest.fn(),
    installPluginFromZipData: jest.fn(),
    installPluginFromUrl: jest.fn()
  }
}));
jest.mock('../utils/ark/ark-server/ark-server-paths.utils', () => ({ isAsaApiLoaderInstalled: jest.fn() }));
// A server this machine runs, unless a test says the mesh placed it on another.
jest.mock('../services/mesh/mesh-service', () => ({
  meshService: { queryRemote: jest.fn(async () => null), forwardIfRemote: jest.fn(async () => null) }
}));
const mockMesh = jest.mocked(meshService);

const mockMessaging = jest.mocked(messagingService);
const mockPlugins = jest.mocked(arkApiPluginService);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('ark-api-handler', () => {
  const sender = { send: jest.fn() };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./ark-api-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  function replies(channel: string): unknown[] {
    return mockMessaging.sendToOriginator.mock.calls.filter(([replyChannel]) => replyChannel === channel).map(call => call[1]);
  }

  describe('get-asaapi-status', () => {
    it.each([
      [true, 'AsaApiLoader.exe'],
      [false, null]
    ])('reports installed=%p', async (installed, loaderExe) => {
      jest.mocked(isAsaApiLoaderInstalled).mockReturnValue(installed);

      await handlers['get-asaapi-status']({ instanceId: 'a1', requestId: 'r1' }, sender);

      expect(isAsaApiLoaderInstalled).toHaveBeenCalledWith('a1');
      expect(replies('get-asaapi-status')).toEqual([{ success: true, installed, loaderExe, requestId: 'r1' }]);
    });
  });

  describe('list-ark-api-plugins', () => {
    it('replies with the plugins', async () => {
      const plugins = [{
        name: 'MyPlugin', version: '1.0', author: 'me', description: '', folderName: 'MyPlugin', enabled: true, hasPluginJson: true
      }];
      mockPlugins.listPlugins.mockReturnValue(plugins);

      await handlers['list-ark-api-plugins']({ instanceId: 'a1', requestId: 'r1' }, sender);

      expect(mockPlugins.listPlugins).toHaveBeenCalledWith('a1');
      expect(replies('list-ark-api-plugins')).toEqual([{ success: true, plugins, requestId: 'r1' }]);
    });

    it('replies with the reason listing fails', async () => {
      mockPlugins.listPlugins.mockImplementation(() => { throw new Error('ArkApi folder unreadable'); });

      await handlers['list-ark-api-plugins']({ instanceId: 'a1', requestId: 'r1' }, sender);

      expect(replies('list-ark-api-plugins')).toEqual([{ success: false, error: 'ArkApi folder unreadable', requestId: 'r1' }]);
    });
  });

  describe('remove-ark-api-plugin', () => {
    it('removes the plugin and names it in the reply', async () => {
      await handlers['remove-ark-api-plugin']({ instanceId: 'a1', folderName: 'MyPlugin', requestId: 'r1' }, sender);

      expect(mockPlugins.removePlugin).toHaveBeenCalledWith('a1', 'MyPlugin');
      expect(replies('remove-ark-api-plugin')).toEqual([{ success: true, folderName: 'MyPlugin', requestId: 'r1' }]);
    });

    it('replies with the reason removal fails', async () => {
      mockPlugins.removePlugin.mockImplementationOnce(() => { throw new Error('Plugin not found'); });

      await handlers['remove-ark-api-plugin']({ instanceId: 'a1', folderName: 'Nope', requestId: 'r1' }, sender);

      expect(replies('remove-ark-api-plugin')).toEqual([{ success: false, error: 'Plugin not found', requestId: 'r1' }]);
    });
  });

  describe('get-asaapi-latest', () => {
    it('replies with the latest release', async () => {
      const release = { version: '1.19', downloadUrl: 'https://github.com/x.zip', name: 'AsaApi 1.19' };
      mockPlugins.getLatestAsaApiRelease.mockResolvedValue(release);

      await handlers['get-asaapi-latest']({ requestId: 'r1' }, sender);

      expect(replies('get-asaapi-latest')).toEqual([{ success: true, ...release, requestId: 'r1' }]);
    });

    it('replies with the reason the release is unavailable', async () => {
      mockPlugins.getLatestAsaApiRelease.mockRejectedValue(new Error('GitHub API returned 403'));

      await handlers['get-asaapi-latest']({ requestId: 'r1' }, sender);

      expect(replies('get-asaapi-latest')).toEqual([{ success: false, error: 'GitHub API returned 403', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockPlugins.getLatestAsaApiRelease.mockResolvedValue({ version: '1.19', downloadUrl: 'https://github.com/x.zip', name: 'n' });

      await handlers['get-asaapi-latest'](undefined, sender);

      expect(replies('get-asaapi-latest')).toEqual([expect.objectContaining({ success: true, requestId: undefined })]);
    });
  });

  describe('download-asaapi', () => {
    it('says it is downloading, installs, then replies', async () => {
      mockPlugins.downloadAsaApi.mockResolvedValue(undefined);

      await handlers['download-asaapi']({ instanceId: 'a1', downloadUrl: 'https://dl.zip', requestId: 'r1' }, sender);

      expect(mockMessaging.sendToOriginator.mock.calls).toEqual([
        ['download-asaapi-progress', { status: 'downloading', requestId: 'r1' }, sender],
        ['download-asaapi', { success: true, requestId: 'r1' }, sender]
      ]);
      expect(mockPlugins.downloadAsaApi).toHaveBeenCalledWith('a1', 'https://dl.zip');
    });

    it('replies with the reason the download fails', async () => {
      mockPlugins.downloadAsaApi.mockRejectedValue(new Error('Download failed'));

      await handlers['download-asaapi']({ instanceId: 'a1', downloadUrl: 'https://dl.zip', requestId: 'r1' }, sender);

      expect(replies('download-asaapi')).toEqual([{ success: false, error: 'Download failed', requestId: 'r1' }]);
    });
  });

  describe('install-plugin-from-zip', () => {
    it('installs the ZIP the desktop names', async () => {
      mockPlugins.readZipAsBase64.mockReturnValue('UEsDBA==');

      await handlers['install-plugin-from-zip']({ instanceId: 'a1', zipPath: '/tmp/plugin.zip', requestId: 'r1' }, sender);

      expect(mockPlugins.readZipAsBase64).toHaveBeenCalledWith('/tmp/plugin.zip');
      expect(mockPlugins.installPluginFromZipData).toHaveBeenCalledWith('a1', 'UEsDBA==');
      expect(replies('install-plugin-from-zip')).toEqual([{ success: true, requestId: 'r1' }]);
    });

    it('refuses a web client, which could name any ZIP on the host', async () => {
      const webClient = { type: 'api-process', cid: 'c1', user: null, authEnabled: false, send: jest.fn() };

      await handlers['install-plugin-from-zip']({ instanceId: 'a1', zipPath: 'C:/Users/x/evil.zip', requestId: 'r1' }, webClient);

      expect(mockPlugins.readZipAsBase64).not.toHaveBeenCalled();
      expect(replies('install-plugin-from-zip')).toEqual([{
        success: false,
        error: 'Only the desktop app can install a plugin from a file path. Use a download URL instead.',
        requestId: 'r1'
      }]);
    });

    // The web UI has no path; the ZIP comes with the request, so it names nothing on the host.
    it('installs a ZIP sent with the request, from the web UI too', async () => {
      const webClient = { type: 'api-process', cid: 'c1', user: null, authEnabled: false, send: jest.fn() };

      await handlers['install-plugin-from-zip']({ instanceId: 'a1', zipData: 'UEsDBA==', requestId: 'r1' }, webClient);

      expect(mockPlugins.installPluginFromZipData).toHaveBeenCalledWith('a1', 'UEsDBA==');
      expect(replies('install-plugin-from-zip')).toEqual([{ success: true, requestId: 'r1' }]);
    });

    it('refuses a ZIP larger than a plugin needs to be', async () => {
      const tooLarge = 'A'.repeat(Math.ceil((50 * 1024 * 1024 + 1) / 3) * 4);

      await handlers['install-plugin-from-zip']({ instanceId: 'a1', zipData: tooLarge, requestId: 'r1' }, sender);

      expect(mockPlugins.installPluginFromZipData).not.toHaveBeenCalled();
      expect(replies('install-plugin-from-zip')).toEqual([{ success: false, error: 'That ZIP is larger than 50 MB.', requestId: 'r1' }]);
    });

    it('replies with the reason the install fails', async () => {
      mockPlugins.readZipAsBase64.mockImplementationOnce(() => { throw new Error('Not a ZIP file'); });

      await handlers['install-plugin-from-zip']({ instanceId: 'a1', zipPath: '/tmp/x', requestId: 'r1' }, sender);

      expect(replies('install-plugin-from-zip')).toEqual([{ success: false, error: 'Not a ZIP file', requestId: 'r1' }]);
    });
  });

  describe('install-plugin-from-url', () => {
    it('installs from the URL', async () => {
      mockPlugins.installPluginFromUrl.mockResolvedValue(undefined);

      await handlers['install-plugin-from-url']({ instanceId: 'a1', url: 'https://dl.zip', requestId: 'r1' }, sender);

      expect(mockPlugins.installPluginFromUrl).toHaveBeenCalledWith('a1', 'https://dl.zip');
      expect(replies('install-plugin-from-url')).toEqual([{ success: true, requestId: 'r1' }]);
    });

    it('replies with the reason the install fails', async () => {
      mockPlugins.installPluginFromUrl.mockRejectedValue(new Error('Invalid URL'));

      await handlers['install-plugin-from-url']({ instanceId: 'a1', url: 'bad', requestId: 'r1' }, sender);

      expect(replies('install-plugin-from-url')).toEqual([{ success: false, error: 'Invalid URL', requestId: 'r1' }]);
    });
  });

  // The tab acted on the machine it was opened on, wherever the server ran.
  describe('for a server on another machine in the mesh', () => {
    it('asks that machine for its plugins and its AsaApi, and looks at nothing here', async () => {
      mockMesh.queryRemote.mockResolvedValueOnce({ success: true, plugins: [{ folderName: 'Far' }] });

      await handlers['list-ark-api-plugins']({ instanceId: 'a1', requestId: 'r1' }, sender);

      expect(mockMesh.queryRemote).toHaveBeenCalledWith('a1', 'ark-api', { action: 'list' });
      expect(mockPlugins.listPlugins).not.toHaveBeenCalled();
      expect(replies('list-ark-api-plugins')).toEqual([{ success: true, plugins: [{ folderName: 'Far' }], requestId: 'r1' }]);
    });

    it('has that machine make the change, and passes on what came of it', async () => {
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: true, detail: { success: true, folderName: 'Permissions' } });

      await handlers['remove-ark-api-plugin']({ instanceId: 'a1', folderName: 'Permissions', requestId: 'r1' }, sender);

      expect(mockMesh.forwardIfRemote).toHaveBeenCalledWith('ark-api', 'a1', 'desktop', { folderName: 'Permissions', action: 'remove' });
      expect(mockPlugins.removePlugin).not.toHaveBeenCalled();
      expect(replies('remove-ark-api-plugin')).toEqual([{ success: true, folderName: 'Permissions', requestId: 'r1' }]);
    });

    it('says why that machine could not do it', async () => {
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: false, error: 'The hosting node is not available.' });

      await handlers['install-plugin-from-url']({ instanceId: 'a1', url: 'https://dl.zip', requestId: 'r1' }, sender);

      expect(replies('install-plugin-from-url')).toEqual([{ success: false, error: 'The hosting node is not available.', requestId: 'r1' }]);
    });

    // That machine cannot open a path on this one.
    it('sends it the contents of a ZIP the desktop names', async () => {
      mockPlugins.readZipAsBase64.mockReturnValue('UEsDBA==');
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: true, detail: { success: true } });

      await handlers['install-plugin-from-zip']({ instanceId: 'a1', zipPath: '/tmp/plugin.zip', requestId: 'r1' }, sender);

      expect(mockMesh.forwardIfRemote).toHaveBeenCalledWith('ark-api', 'a1', 'desktop', { zipData: 'UEsDBA==', action: 'install-zip' });
      expect(mockPlugins.installPluginFromZipData).not.toHaveBeenCalled();
    });

    it('downloads AsaApi there, not here', async () => {
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: true, detail: { success: true } });

      await handlers['download-asaapi']({ instanceId: 'a1', downloadUrl: 'https://dl/asaapi.zip', requestId: 'r1' }, sender);

      expect(mockMesh.forwardIfRemote).toHaveBeenCalledWith('ark-api', 'a1', 'desktop', { downloadUrl: 'https://dl/asaapi.zip', action: 'download-asaapi' });
      expect(mockPlugins.downloadAsaApi).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ['get-asaapi-status', () => isAsaApiLoaderInstalled],
    ['list-ark-api-plugins', () => mockPlugins.listPlugins],
    ['remove-ark-api-plugin', () => mockPlugins.removePlugin],
    ['download-asaapi', () => mockPlugins.downloadAsaApi],
    ['install-plugin-from-zip', () => mockPlugins.installPluginFromZipData],
    ['install-plugin-from-url', () => mockPlugins.installPluginFromUrl]
  ])('%s', (channel, target) => {
    it.each([[{ instanceId: '../x', requestId: 'r1' }, 'r1'], [undefined, undefined]])(
      'refuses an invalid instance id without touching any files (payload %p)',
      async (payload, requestId) => {
        await handlers[channel](payload, sender);

        expect(target()).not.toHaveBeenCalled();
        expect(mockMessaging.sendToOriginator.mock.calls).toEqual([
          [channel, { success: false, error: 'Invalid instance ID', requestId }, sender]
        ]);
      }
    );
  });
});
