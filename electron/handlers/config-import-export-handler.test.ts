import { jest } from '@jest/globals';

jest.mock('../services/messaging.service', () => ({
  messagingService: {
    on: jest.fn(),
    sendToOriginator: jest.fn(),
    sendToAll: jest.fn(),
    sendToAllRenderers: jest.fn(),
  },
}));

jest.mock('../services/config-import-export.service', () => ({
  configImportExportService: {
    exportConfigAsZip: jest.fn(),
    importFromIni: jest.fn(),
  },
}));

jest.mock('../utils/ark/instance.utils', () => ({
  getInstance: jest.fn(),
}));

jest.mock('../services/server-instance/server-management.service', () => ({
  serverManagementService: {
    saveInstance: jest.fn(),
    getAllInstances: jest.fn(),
  },
}));

import { messagingService } from '../services/messaging.service';
import { configImportExportService } from '../services/config-import-export.service';
import * as instanceUtils from '../utils/ark/instance.utils';
import { serverManagementService } from '../services/server-instance/server-management.service';

const mockMessaging = messagingService as jest.Mocked<typeof messagingService>;
const mockConfigService = configImportExportService as jest.Mocked<typeof configImportExportService>;
const mockInstanceUtils = instanceUtils as jest.Mocked<typeof instanceUtils>;
const mockServerMgmt = serverManagementService as jest.Mocked<typeof serverManagementService>;

describe('config-import-export-handler', () => {
  let handlers: Record<string, (...args: any[]) => Promise<void>>;
  let mockSender: any;

  beforeAll(() => {
    require('./config-import-export-handler');

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

  it('should register export and import handlers', () => {
    expect(handlers['export-server-config']).toBeDefined();
    expect(handlers['import-server-config']).toBeDefined();
  });

  describe('export-server-config', () => {
    it('should export config as zip successfully', async () => {
      const config = { id: 'inst1', name: 'TestServer', maxPlayers: 10 };
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockReturnValue(config);
      (mockConfigService.exportConfigAsZip as jest.Mock<any>).mockReturnValue({
        success: true,
        base64: 'dGVzdA==',
      });

      await handlers['export-server-config']({ id: 'inst1', requestId: 'r1' }, mockSender);

      expect(mockInstanceUtils.getInstance).toHaveBeenCalledWith('inst1');
      expect(mockConfigService.exportConfigAsZip).toHaveBeenCalledWith(config);
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'export-server-config',
        {
          success: true,
          base64: 'dGVzdA==',
          suggestedFileName: 'TestServer-config.zip',
          requestId: 'r1',
        },
        mockSender
      );
    });

    it('should fail when no ID provided', async () => {
      await handlers['export-server-config']({ requestId: 'r1' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'export-server-config',
        expect.objectContaining({ success: false, error: 'Server instance ID is required' }),
        mockSender
      );
    });

    it('should fail when instance not found', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockReturnValue(null);

      await handlers['export-server-config']({ id: 'missing', requestId: 'r1' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'export-server-config',
        expect.objectContaining({ success: false, error: 'Server instance not found: missing' }),
        mockSender
      );
    });

    it('should fail when zip creation fails', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockReturnValue({ id: 'inst1', name: 'Test' });
      (mockConfigService.exportConfigAsZip as jest.Mock<any>).mockReturnValue({
        success: false,
        error: 'Zip error',
      });

      await handlers['export-server-config']({ id: 'inst1', requestId: 'r1' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'export-server-config',
        expect.objectContaining({ success: false }),
        mockSender
      );
    });

    it('should use fallback name when config has no name', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockReturnValue({ id: 'inst1' });
      (mockConfigService.exportConfigAsZip as jest.Mock<any>).mockReturnValue({ success: true, base64: 'abc' });

      await handlers['export-server-config']({ id: 'inst1', requestId: 'r1' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'export-server-config',
        expect.objectContaining({ suggestedFileName: 'server-config.zip' }),
        mockSender
      );
    });
  });

  describe('import-server-config', () => {
    it('should import config without target (preview mode)', async () => {
      (mockConfigService.importFromIni as jest.Mock<any>).mockReturnValue({
        success: true,
        config: { maxPlayers: 20 },
        warnings: [],
      });

      await handlers['import-server-config'](
        { content: '[ServerSettings]\nMaxPlayers=20', fileName: 'GameUserSettings.ini', requestId: 'r2' },
        mockSender
      );

      expect(mockConfigService.importFromIni).toHaveBeenCalledWith([
        { fileName: 'GameUserSettings.ini', content: '[ServerSettings]\nMaxPlayers=20' },
      ]);
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'import-server-config',
        expect.objectContaining({ success: true, merged: false, config: { maxPlayers: 20 } }),
        mockSender
      );
    });

    it('should import and merge into existing instance', async () => {
      const existing = { id: 'inst1', name: 'Server1', maxPlayers: 10 };
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockReturnValue(existing);
      (mockConfigService.importFromIni as jest.Mock<any>).mockReturnValue({
        success: true,
        config: { maxPlayers: 30 },
        warnings: [],
      });
      (mockServerMgmt.saveInstance as jest.Mock<any>).mockResolvedValue({
        success: true,
        instance: { id: 'inst1', name: 'Server1', maxPlayers: 30 },
      });
      (mockServerMgmt.getAllInstances as jest.Mock<any>).mockResolvedValue({ instances: [] });

      await handlers['import-server-config'](
        { targetId: 'inst1', content: 'data', requestId: 'r2' },
        mockSender
      );

      expect(mockServerMgmt.saveInstance).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'inst1', name: 'Server1', maxPlayers: 30 })
      );
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'import-server-config',
        expect.objectContaining({ success: true, merged: true }),
        mockSender
      );
    });

    it('should fail when no content provided', async () => {
      await handlers['import-server-config']({ requestId: 'r2' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'import-server-config',
        expect.objectContaining({ success: false, error: 'No INI content provided' }),
        mockSender
      );
    });

    it('should fail when target instance not found', async () => {
      (mockConfigService.importFromIni as jest.Mock<any>).mockReturnValue({
        success: true,
        config: {},
        warnings: [],
      });
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockReturnValue(null);

      await handlers['import-server-config'](
        { targetId: 'missing', content: 'data', requestId: 'r2' },
        mockSender
      );

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'import-server-config',
        expect.objectContaining({ success: false, error: 'Target server not found: missing' }),
        mockSender
      );
    });

    it('should fail when import parsing fails', async () => {
      (mockConfigService.importFromIni as jest.Mock<any>).mockReturnValue({
        success: false,
        error: 'Malformed INI',
      });

      await handlers['import-server-config'](
        { content: 'bad data', requestId: 'r2' },
        mockSender
      );

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'import-server-config',
        expect.objectContaining({ success: false }),
        mockSender
      );
    });

    it('should use default filename when not provided', async () => {
      (mockConfigService.importFromIni as jest.Mock<any>).mockReturnValue({
        success: true,
        config: {},
        warnings: [],
      });

      await handlers['import-server-config']({ content: 'data', requestId: 'r2' }, mockSender);

      expect(mockConfigService.importFromIni).toHaveBeenCalledWith([
        { fileName: 'GameUserSettings.ini', content: 'data' },
      ]);
    });
  });
});
