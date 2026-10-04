import { messagingService } from '../services/messaging.service';
import { configImportExportService } from '../services/config-import-export.service';
import { serverInstanceService } from '../services/server-instance/server-instance.service';
import { serverManagementService } from '../services/server-instance/server-management.service';
import * as instanceUtils from '../utils/ark/instance.utils';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn(), sendToAll: jest.fn() }
}));
jest.mock('../services/config-import-export.service', () => ({
  configImportExportService: { exportConfigAsZip: jest.fn(), importFromIni: jest.fn() }
}));
jest.mock('../services/server-instance/server-instance.service', () => ({
  serverInstanceService: { broadcastInstances: jest.fn() }
}));
jest.mock('../services/server-instance/server-management.service', () => ({
  serverManagementService: { saveInstance: jest.fn() }
}));
jest.mock('../utils/ark/instance.utils', () => ({ getInstance: jest.fn() }));

const mockMessaging = jest.mocked(messagingService);
const mockConfigService = jest.mocked(configImportExportService);
const mockGetInstance = jest.mocked(instanceUtils.getInstance);
const mockSaveInstance = jest.mocked(serverManagementService.saveInstance);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('config-import-export-handler', () => {
  const sender = { send: jest.fn() };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./config-import-export-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  beforeEach(() => {
    mockGetInstance.mockReset();
  });

  function replies(channel: string): unknown[] {
    return mockMessaging.sendToOriginator.mock.calls.filter(([replyChannel]) => replyChannel === channel).map(call => call[1]);
  }

  describe('export-server-config', () => {
    it('replies with the INI files as a base64 ZIP named after the server', async () => {
      const config = { id: 'a1', name: 'TestServer', maxPlayers: 10 };
      mockGetInstance.mockReturnValue(config);
      mockConfigService.exportConfigAsZip.mockReturnValue({ success: true, base64: 'dGVzdA==' });

      await handlers['export-server-config']({ id: 'a1', requestId: 'r1' }, sender);

      expect(mockGetInstance).toHaveBeenCalledWith('a1');
      expect(mockConfigService.exportConfigAsZip).toHaveBeenCalledWith(config);
      expect(replies('export-server-config')).toEqual([
        { success: true, base64: 'dGVzdA==', suggestedFileName: 'TestServer-config.zip', requestId: 'r1' }
      ]);
    });

    it('names the file "server" when the server has no name', async () => {
      mockGetInstance.mockReturnValue({ id: 'a1' });
      mockConfigService.exportConfigAsZip.mockReturnValue({ success: true, base64: 'abc' });

      await handlers['export-server-config']({ id: 'a1', requestId: 'r1' }, sender);

      expect(replies('export-server-config')).toEqual([expect.objectContaining({ suggestedFileName: 'server-config.zip' })]);
    });

    it.each([
      ['no id', { requestId: 'r1' }, 'Server instance ID is required'],
      ['an invalid id', { id: '../x', requestId: 'r1' }, 'Invalid instance ID'],
      ['an unknown server', { id: 'missing', requestId: 'r1' }, 'Server instance not found: missing']
    ])('refuses %s without reading any config file', async (_label, payload, error) => {
      mockGetInstance.mockReturnValue(null);

      await handlers['export-server-config'](payload, sender);

      expect(mockConfigService.exportConfigAsZip).not.toHaveBeenCalled();
      expect(replies('export-server-config')).toEqual([{ success: false, error, requestId: 'r1' }]);
    });

    it.each([['Zip error', 'Zip error'], [undefined, 'Failed to create ZIP']])(
      'replies a failure when the ZIP cannot be made (%p)',
      async (zipError, error) => {
        mockGetInstance.mockReturnValue({ id: 'a1', name: 'Test' });
        mockConfigService.exportConfigAsZip.mockReturnValue({ success: false, error: zipError });

        await handlers['export-server-config']({ id: 'a1', requestId: 'r1' }, sender);

        expect(replies('export-server-config')).toEqual([{ success: false, error, requestId: 'r1' }]);
      }
    );

    it('replies a failure when the config cannot be read', async () => {
      mockGetInstance.mockImplementation(() => { throw new Error('EACCES'); });

      await handlers['export-server-config']({ id: 'a1', requestId: 'r1' }, sender);

      expect(replies('export-server-config')).toEqual([{ success: false, error: 'EACCES', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      await handlers['export-server-config'](undefined, sender);

      expect(replies('export-server-config')).toEqual([
        { success: false, error: 'Server instance ID is required', requestId: undefined }
      ]);
    });
  });

  describe('import-server-config', () => {
    it('only returns the parsed settings when there is no target', async () => {
      mockConfigService.importFromIni.mockReturnValue({ success: true, config: { maxPlayers: 20 }, warnings: ['x'] });

      await handlers['import-server-config'](
        { content: '[ServerSettings]\nMaxPlayers=20', fileName: 'GameUserSettings.ini', requestId: 'r1' }, sender
      );

      expect(mockConfigService.importFromIni).toHaveBeenCalledWith([
        { fileName: 'GameUserSettings.ini', content: '[ServerSettings]\nMaxPlayers=20' }
      ]);
      expect(mockSaveInstance).not.toHaveBeenCalled();
      expect(replies('import-server-config')).toEqual([
        { success: true, config: { maxPlayers: 20 }, merged: false, warnings: ['x'], requestId: 'r1' }
      ]);
      expect(mockMessaging.sendToAll).toHaveBeenCalledWith('notification', {
        type: 'success', message: 'Server configuration imported successfully. (1 warnings)'
      });
    });

    it('reads the file as GameUserSettings.ini when it has no name', async () => {
      mockConfigService.importFromIni.mockReturnValue({ success: true, config: {}, warnings: [] });

      await handlers['import-server-config']({ content: 'data', requestId: 'r1' }, sender);

      expect(mockConfigService.importFromIni).toHaveBeenCalledWith([{ fileName: 'GameUserSettings.ini', content: 'data' }]);
    });

    it('merges into the target, keeping its id and name, and tells every client', async () => {
      const saved = { id: 'a1', name: 'Server1', maxPlayers: 30 };
      mockGetInstance.mockReturnValue({ id: 'a1', name: 'Server1', maxPlayers: 10 });
      mockConfigService.importFromIni.mockReturnValue({
        success: true, config: { id: 'other', name: 'Other', maxPlayers: 30 }, warnings: []
      });
      mockSaveInstance.mockResolvedValue({ success: true, instance: saved });

      await handlers['import-server-config']({ targetId: 'a1', content: 'data', requestId: 'r1' }, sender);

      expect(mockSaveInstance).toHaveBeenCalledWith({ id: 'a1', name: 'Server1', maxPlayers: 30 });
      expect(serverInstanceService.broadcastInstances).toHaveBeenCalled();
      expect(mockMessaging.sendToAll).toHaveBeenCalledWith('server-instance-updated', saved);
      expect(replies('import-server-config')).toEqual([{ success: true, config: saved, merged: true, warnings: [], requestId: 'r1' }]);
      const notification = mockMessaging.sendToAll.mock.calls.findIndex(([channel]) => channel === 'notification');
      expect(mockMessaging.sendToOriginator.mock.invocationCallOrder[0])
        .toBeLessThan(mockMessaging.sendToAll.mock.invocationCallOrder[notification]);
      expect(mockMessaging.sendToAll.mock.calls[notification][1]).toEqual({
        type: 'success', message: 'Server configuration imported successfully.'
      });
    });

    it('passes on a merge the instance store refused, without notifications', async () => {
      mockGetInstance.mockReturnValue({ id: 'a1', name: 'Server1' });
      mockConfigService.importFromIni.mockReturnValue({ success: true, config: {}, warnings: [] });
      mockSaveInstance.mockResolvedValue({ success: false, error: 'Invalid port' });

      await handlers['import-server-config']({ targetId: 'a1', content: 'data', requestId: 'r1' }, sender);

      expect(replies('import-server-config')).toEqual([{ success: false, error: 'Invalid port', requestId: 'r1' }]);
      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
    });

    it.each([
      ['no content', { requestId: 'r1' }, 'No INI content provided'],
      ['an invalid target id', { targetId: '../x', content: 'data', requestId: 'r1' }, 'Invalid instance ID'],
      ['an unknown target', { targetId: 'missing', content: 'data', requestId: 'r1' }, 'Target server not found: missing']
    ])('refuses %s without saving or notifying', async (_label, payload, error) => {
      mockConfigService.importFromIni.mockReturnValue({ success: true, config: {}, warnings: [] });
      mockGetInstance.mockReturnValue(null);

      await handlers['import-server-config'](payload, sender);

      expect(mockSaveInstance).not.toHaveBeenCalled();
      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
      expect(replies('import-server-config')).toEqual([{ success: false, error, requestId: 'r1' }]);
    });

    it('replies the parser\'s reason when the file cannot be read', async () => {
      mockConfigService.importFromIni.mockReturnValue({ success: false, error: 'Malformed INI' });

      await handlers['import-server-config']({ content: 'bad data', requestId: 'r1' }, sender);

      expect(replies('import-server-config')).toEqual([{ success: false, error: 'Malformed INI', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      await handlers['import-server-config'](undefined, sender);

      expect(replies('import-server-config')).toEqual([{ success: false, error: 'No INI content provided', requestId: undefined }]);
    });
  });
});
