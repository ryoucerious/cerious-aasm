import { jest } from '@jest/globals';

jest.mock('../services/messaging.service', () => ({
  messagingService: {
    on: jest.fn(),
    sendToOriginator: jest.fn(),
    sendToAll: jest.fn(),
  },
}));

jest.mock('../services/ark-api-plugin.service', () => ({
  arkApiPluginService: {
    listPlugins: jest.fn(),
    removePlugin: jest.fn(),
    getLatestAsaApiRelease: jest.fn(),
    downloadAsaApi: jest.fn(),
    installPluginFromZipPath: jest.fn(),
    installPluginFromUrl: jest.fn(),
  },
}));

import { messagingService } from '../services/messaging.service';
import { arkApiPluginService } from '../services/ark-api-plugin.service';

const mockMessaging = messagingService as jest.Mocked<typeof messagingService>;
const mockPluginService = arkApiPluginService as jest.Mocked<typeof arkApiPluginService>;

describe('ark-api-handler', () => {
  let handlers: Record<string, (...args: any[]) => Promise<void>>;
  let mockSender: any;

  beforeAll(() => {
    require('./ark-api-handler');

    handlers = {};
    for (const call of (mockMessaging.on as jest.Mock).mock.calls) {
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
    expect(handlers['list-ark-api-plugins']).toBeDefined();
    expect(handlers['remove-ark-api-plugin']).toBeDefined();
    expect(handlers['get-asaapi-latest']).toBeDefined();
    expect(handlers['download-asaapi']).toBeDefined();
    expect(handlers['install-plugin-from-zip']).toBeDefined();
    expect(handlers['install-plugin-from-url']).toBeDefined();
  });

  describe('list-ark-api-plugins', () => {
    it('should list plugins successfully', async () => {
      const plugins = [{ name: 'TestPlugin', version: '1.0' }];
      (mockPluginService.listPlugins as jest.Mock).mockReturnValue(plugins);

      await handlers['list-ark-api-plugins']({ instanceId: 'inst1', requestId: 'r1' }, mockSender);

      expect(mockPluginService.listPlugins).toHaveBeenCalledWith('inst1');
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'list-ark-api-plugins',
        { success: true, plugins, requestId: 'r1' },
        mockSender
      );
    });

    it('should handle errors', async () => {
      (mockPluginService.listPlugins as jest.Mock).mockImplementation(() => {
        throw new Error('Not found');
      });

      await handlers['list-ark-api-plugins']({ instanceId: 'inst1', requestId: 'r1' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'list-ark-api-plugins',
        { success: false, error: 'Not found', requestId: 'r1' },
        mockSender
      );
    });

    it('should handle undefined payload', async () => {
      (mockPluginService.listPlugins as jest.Mock).mockReturnValue([]);

      await handlers['list-ark-api-plugins'](undefined, mockSender);

      expect(mockPluginService.listPlugins).toHaveBeenCalledWith(undefined);
    });
  });

  describe('remove-ark-api-plugin', () => {
    it('should remove plugin successfully', async () => {
      await handlers['remove-ark-api-plugin']({ instanceId: 'inst1', folderName: 'MyPlugin', requestId: 'r2' }, mockSender);

      expect(mockPluginService.removePlugin).toHaveBeenCalledWith('inst1', 'MyPlugin');
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'remove-ark-api-plugin',
        { success: true, folderName: 'MyPlugin', requestId: 'r2' },
        mockSender
      );
    });

    it('should handle removal errors', async () => {
      (mockPluginService.removePlugin as jest.Mock).mockImplementation(() => {
        throw new Error('Plugin not found');
      });

      await handlers['remove-ark-api-plugin']({ instanceId: 'inst1', folderName: 'Bad', requestId: 'r2' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'remove-ark-api-plugin',
        { success: false, error: 'Plugin not found', requestId: 'r2' },
        mockSender
      );
    });
  });

  describe('get-asaapi-latest', () => {
    it('should fetch latest release successfully', async () => {
      const release = { version: 'v1.2.0', downloadUrl: 'https://example.com/dl.zip', name: 'AsaApi' };
      (mockPluginService.getLatestAsaApiRelease as jest.Mock).mockResolvedValue(release);

      await handlers['get-asaapi-latest']({ requestId: 'r3' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'get-asaapi-latest',
        { success: true, ...release, requestId: 'r3' },
        mockSender
      );
    });

    it('should handle fetch errors', async () => {
      (mockPluginService.getLatestAsaApiRelease as jest.Mock).mockRejectedValue(new Error('Network error'));

      await handlers['get-asaapi-latest']({ requestId: 'r3' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'get-asaapi-latest',
        { success: false, error: 'Network error', requestId: 'r3' },
        mockSender
      );
    });
  });

  describe('download-asaapi', () => {
    it('should download AsaApi successfully', async () => {
      (mockPluginService.downloadAsaApi as jest.Mock).mockResolvedValue(undefined);

      await handlers['download-asaapi']({ instanceId: 'inst1', downloadUrl: 'https://dl.zip', requestId: 'r4' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'download-asaapi-progress',
        { status: 'downloading', requestId: 'r4' },
        mockSender
      );
      expect(mockPluginService.downloadAsaApi).toHaveBeenCalledWith('inst1', 'https://dl.zip');
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'download-asaapi',
        { success: true, requestId: 'r4' },
        mockSender
      );
    });

    it('should handle download errors', async () => {
      (mockPluginService.downloadAsaApi as jest.Mock).mockRejectedValue(new Error('Download failed'));

      await handlers['download-asaapi']({ instanceId: 'inst1', downloadUrl: 'https://dl.zip', requestId: 'r4' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'download-asaapi',
        { success: false, error: 'Download failed', requestId: 'r4' },
        mockSender
      );
    });
  });

  describe('install-plugin-from-zip', () => {
    it('should install from zip path successfully', async () => {
      await handlers['install-plugin-from-zip']({ instanceId: 'inst1', zipPath: '/tmp/plugin.zip', requestId: 'r5' }, mockSender);

      expect(mockPluginService.installPluginFromZipPath).toHaveBeenCalledWith('inst1', '/tmp/plugin.zip');
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'install-plugin-from-zip',
        { success: true, requestId: 'r5' },
        mockSender
      );
    });

    it('should handle install errors', async () => {
      (mockPluginService.installPluginFromZipPath as jest.Mock).mockImplementation(() => {
        throw new Error('ZIP not found');
      });

      await handlers['install-plugin-from-zip']({ instanceId: 'inst1', zipPath: '/bad.zip', requestId: 'r5' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'install-plugin-from-zip',
        { success: false, error: 'ZIP not found', requestId: 'r5' },
        mockSender
      );
    });
  });

  describe('install-plugin-from-url', () => {
    it('should install from URL successfully', async () => {
      (mockPluginService.installPluginFromUrl as jest.Mock).mockResolvedValue(undefined);

      await handlers['install-plugin-from-url']({ instanceId: 'inst1', url: 'https://dl.zip', requestId: 'r6' }, mockSender);

      expect(mockPluginService.installPluginFromUrl).toHaveBeenCalledWith('inst1', 'https://dl.zip');
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'install-plugin-from-url',
        { success: true, requestId: 'r6' },
        mockSender
      );
    });

    it('should handle URL install errors', async () => {
      (mockPluginService.installPluginFromUrl as jest.Mock).mockRejectedValue(new Error('Timeout'));

      await handlers['install-plugin-from-url']({ instanceId: 'inst1', url: 'https://dl.zip', requestId: 'r6' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'install-plugin-from-url',
        { success: false, error: 'Timeout', requestId: 'r6' },
        mockSender
      );
    });
  });
});
