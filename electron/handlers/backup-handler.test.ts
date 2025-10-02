import * as backupHandler from './backup-handler';
// Mock the services
jest.mock('../services/messaging.service');
jest.mock('../services/backup/backup.service', () => ({
  backupService: {
    initializeBackupSystem: jest.fn(),
    createBackup: jest.fn(),
    getBackupList: jest.fn(),
    restoreBackup: jest.fn(),
    deleteBackup: jest.fn(),
    getBackupSettings: jest.fn(),
    saveBackupSettings: jest.fn(),
    startBackupScheduler: jest.fn(),
    stopBackupScheduler: jest.fn(),
    getSchedulerStatus: jest.fn(),
    downloadBackup: jest.fn()
  }
}));

import { messagingService } from '../services/messaging.service';
import { backupService } from '../services/backup/backup.service';

const mockMessagingService = messagingService as jest.Mocked<typeof messagingService>;
const mockBackupService = backupService as jest.Mocked<typeof backupService>;

// Store handler functions for testing
let createBackupHandler: Function;
let getBackupListHandler: Function;
let restoreBackupHandler: Function;
let deleteBackupHandler: Function;
let getBackupSettingsHandler: Function;
let saveBackupSettingsHandler: Function;
let startBackupSchedulerHandler: Function;
let stopBackupSchedulerHandler: Function;
let getSchedulerStatusHandler: Function;
let downloadBackupHandler: Function;

describe('Backup Handler', () => {
  let mockSender: any;
  beforeEach(() => { mockSender = {}; });
  it('should call initializeBackupSystem()', async () => {
    await backupHandler.initializeBackupSystem();
    expect(mockBackupService.initializeBackupSystem).toHaveBeenCalled();
  });

  beforeAll(() => {
    // Import handler to register events
    require('./backup-handler');

    // Capture the registered event handlers
    const mockOn = mockMessagingService.on as jest.Mock;
    mockOn.mock.calls.forEach(([event, handler]) => {
      switch (event) {
        case 'create-backup':
          createBackupHandler = handler;
          break;
        case 'get-backup-list':
          getBackupListHandler = handler;
          break;
        case 'restore-backup':
          restoreBackupHandler = handler;
          break;
        case 'delete-backup':
          deleteBackupHandler = handler;
          break;
        case 'get-backup-settings':
          getBackupSettingsHandler = handler;
          break;
        case 'save-backup-settings':
          saveBackupSettingsHandler = handler;
          break;
        case 'start-backup-scheduler':
          startBackupSchedulerHandler = handler;
          break;
        case 'stop-backup-scheduler':
          stopBackupSchedulerHandler = handler;
          break;
        case 'get-scheduler-status':
          getSchedulerStatusHandler = handler;
          break;
        case 'download-backup':
          downloadBackupHandler = handler;
          break;
      }
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create-backup event', () => {
    it('should handle create backup exception with non-Error', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = 'some string error';

      mockBackupService.createBackup.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await createBackupHandler(payload, mockSender);

      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle create-backup:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('create-backup', {
        success: false,
        error: 'Failed to create backup',
        requestId: 'test-123'
      }, mockSender);
      consoleSpy.mockRestore();
    });
  let mockSender: any;
  beforeEach(() => { mockSender = {}; });
    it('should create backup successfully', async () => {
      const payload = {
        instanceId: 'test-instance',
        type: 'manual' as const,
        name: 'Test Backup',
        requestId: 'test-123'
      };
      const expectedResult = {
        success: true,
        backupId: 'backup-123',
        message: 'Backup created successfully'
      };

      mockBackupService.createBackup.mockResolvedValue(expectedResult);

      await createBackupHandler(payload, mockSender);

      expect(mockBackupService.createBackup).toHaveBeenCalledWith('test-instance', 'manual', 'Test Backup');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('create-backup', {
        success: true,
        backupId: 'backup-123',
        message: 'Backup created successfully',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle create backup failure', async () => {
      const payload = {
        instanceId: 'test-instance',
        type: 'scheduled' as const,
        requestId: 'test-123'
      };
      const expectedResult = {
        success: false,
        error: 'Instance not found'
      };

      mockBackupService.createBackup.mockResolvedValue(expectedResult);

      await createBackupHandler(payload, mockSender);

      expect(mockBackupService.createBackup).toHaveBeenCalledWith('test-instance', 'scheduled', undefined);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('create-backup', {
        success: false,
        error: 'Instance not found',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle create backup exception', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = new Error('Disk full');

      mockBackupService.createBackup.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await createBackupHandler(payload, mockSender);

      expect(mockBackupService.createBackup).toHaveBeenCalledWith('test-instance', undefined, undefined);
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle create-backup:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('create-backup', {
        success: false,
        error: 'Disk full',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });
  });

  describe('get-backup-list event', () => {
    it('should handle get backup list exception with non-Error', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = 42;

      mockBackupService.getBackupList.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getBackupListHandler(payload, mockSender);

      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle get-backup-list:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-backup-list', {
        success: false,
        error: 'Failed to get backup list',
        requestId: 'test-123'
      }, mockSender);
      consoleSpy.mockRestore();
    });
  let mockSender: any;
  beforeEach(() => { mockSender = {}; });
  it('should get backup list successfully', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const expectedResult = {
        success: true,
        backups: [
          {
            id: 'backup-1',
            instanceId: 'test-instance',
            name: 'Backup 1',
            createdAt: new Date(),
            size: 1024,
            type: 'manual' as const,
            filePath: '/path/to/backup-1.zip'
          },
          {
            id: 'backup-2',
            instanceId: 'test-instance',
            name: 'Backup 2',
            createdAt: new Date(),
            size: 2048,
            type: 'scheduled' as const,
            filePath: '/path/to/backup-2.zip'
          }
        ]
      };

      mockBackupService.getBackupList.mockResolvedValue(expectedResult);

      await getBackupListHandler(payload, mockSender);

      expect(mockBackupService.getBackupList).toHaveBeenCalledWith('test-instance');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-backup-list', {
        success: true,
        backups: expectedResult.backups,
        requestId: 'test-123'
      }, mockSender);
    });

  it('should handle get backup list failure', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const expectedResult = {
        success: false,
        error: 'Instance not found'
      };

      mockBackupService.getBackupList.mockResolvedValue(expectedResult);

      await getBackupListHandler(payload, mockSender);

      expect(mockBackupService.getBackupList).toHaveBeenCalledWith('test-instance');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-backup-list', {
        success: false,
        error: 'Instance not found',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle get backup list exception', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = new Error('Permission denied');

      mockBackupService.getBackupList.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getBackupListHandler(payload, mockSender);

      expect(mockBackupService.getBackupList).toHaveBeenCalledWith('test-instance');
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle get-backup-list:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-backup-list', {
        success: false,
        error: 'Permission denied',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });
  });

  describe('restore-backup event', () => {
    it('should handle restore backup exception with non-Error', async () => {
      const payload = { instanceId: 'test-instance', backupId: 'backup-123', requestId: 'test-123' };
      const error = null;

      mockBackupService.restoreBackup.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await restoreBackupHandler(payload, mockSender);

      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle restore-backup:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('restore-backup', {
        success: false,
        error: 'Failed to restore backup',
        requestId: 'test-123'
      }, mockSender);
      consoleSpy.mockRestore();
    });
  let mockSender: any;
  beforeEach(() => { mockSender = {}; });
  it('should restore backup successfully', async () => {
      const payload = {
        instanceId: 'test-instance',
        backupId: 'backup-123',
        requestId: 'test-123'
      };
      const expectedResult = {
        success: true,
        message: 'Backup restored successfully'
      };

      mockBackupService.restoreBackup.mockResolvedValue(expectedResult);

      await restoreBackupHandler(payload, mockSender);

      expect(mockBackupService.restoreBackup).toHaveBeenCalledWith('test-instance', 'backup-123');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('restore-backup', {
        success: true,
        message: 'Backup restored successfully',
        requestId: 'test-123'
      }, mockSender);
    });

  it('should handle restore backup failure', async () => {
      const payload = {
        instanceId: 'test-instance',
        backupId: 'backup-123',
        requestId: 'test-123'
      };
      const expectedResult = {
        success: false,
        error: 'Backup not found'
      };

      mockBackupService.restoreBackup.mockResolvedValue(expectedResult);

      await restoreBackupHandler(payload, mockSender);

      expect(mockBackupService.restoreBackup).toHaveBeenCalledWith('test-instance', 'backup-123');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('restore-backup', {
        success: false,
        error: 'Backup not found',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle restore backup exception', async () => {
      const payload = { instanceId: 'test-instance', backupId: 'backup-123', requestId: 'test-123' };
      const error = new Error('Restore failed');

      mockBackupService.restoreBackup.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await restoreBackupHandler(payload, mockSender);

      expect(mockBackupService.restoreBackup).toHaveBeenCalledWith('test-instance', 'backup-123');
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle restore-backup:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('restore-backup', {
        success: false,
        error: 'Restore failed',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });
  });

  describe('delete-backup event', () => {
    it('should handle delete backup exception with non-Error', async () => {
      const payload = { backupId: 'backup-123', requestId: 'test-123' };
      const error = undefined;

      mockBackupService.deleteBackup.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await deleteBackupHandler(payload, mockSender);

      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle delete-backup:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('delete-backup', {
        success: false,
        error: 'Failed to delete backup',
        requestId: 'test-123'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle get backup settings exception with non-Error', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = false;

      mockBackupService.getBackupSettings.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getBackupSettingsHandler(payload, mockSender);

      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle get-backup-settings:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-backup-settings', {
        success: false,
        error: 'Failed to get backup settings',
        requestId: 'test-123'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle delete backup exception', async () => {
      const payload = { backupId: 'backup-123', requestId: 'test-123' };
      const error = new Error('Delete failed');

      mockBackupService.deleteBackup.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await deleteBackupHandler(payload, mockSender);

      expect(mockBackupService.deleteBackup).toHaveBeenCalledWith('backup-123');
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle delete-backup:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('delete-backup', {
        success: false,
        error: 'Delete failed',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });

describe('Backup Handler', () => {

  describe('get-backup-settings event', () => {
    it('should handle get backup settings success', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const settings = {
        instanceId: 'test-instance',
        enabled: true,
        frequency: 'daily' as const,
        time: '02:00',
        maxBackupsToKeep: 5
      };
      const expectedResult = { success: true, settings };
      mockBackupService.getBackupSettings.mockResolvedValue(expectedResult);

      await getBackupSettingsHandler(payload, mockSender);

      expect(mockBackupService.getBackupSettings).toHaveBeenCalledWith('test-instance');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-backup-settings', {
        success: true,
        settings,
        requestId: 'test-123'
      }, mockSender);
    });
    it('should handle get backup settings exception with non-Error (no message property)', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = 42; // primitive, no message property

      mockBackupService.getBackupSettings.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getBackupSettingsHandler(payload, mockSender);

      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle get-backup-settings:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-backup-settings', {
        success: false,
        error: 'Failed to get backup settings',
        requestId: 'test-123'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle get backup settings exception with non-Error', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = 42;

      mockBackupService.getBackupSettings.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getBackupSettingsHandler(payload, mockSender);

      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle get-backup-settings:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-backup-settings', {
        success: false,
        error: 'Failed to get backup settings',
        requestId: 'test-123'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle get backup settings failure', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const expectedResult = { success: false, error: 'Settings not found' };
      mockBackupService.getBackupSettings.mockResolvedValue(expectedResult);

      await getBackupSettingsHandler(payload, mockSender);

      expect(mockBackupService.getBackupSettings).toHaveBeenCalledWith('test-instance');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-backup-settings', {
        success: false,
        error: 'Settings not found',
        requestId: 'test-123'
      }, mockSender);
    });
    it('should handle get backup settings failure', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const expectedResult = {
        success: false,
        error: 'Settings not found'
      };

      mockBackupService.getBackupSettings.mockResolvedValue(expectedResult);

      await getBackupSettingsHandler(payload, mockSender);

      expect(mockBackupService.getBackupSettings).toHaveBeenCalledWith('test-instance');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-backup-settings', {
        success: false,
        error: 'Settings not found',
        requestId: 'test-123'
      }, mockSender);
    });
  });
});
  let mockSender: any;
  beforeEach(() => { mockSender = {}; });
  it('should delete backup successfully', async () => {
      const payload = { backupId: 'backup-123', requestId: 'test-123' };
      const expectedResult = {
        success: true,
        message: 'Backup deleted successfully'
      };

      mockBackupService.deleteBackup.mockResolvedValue(expectedResult);

      await deleteBackupHandler(payload, mockSender);

      expect(mockBackupService.deleteBackup).toHaveBeenCalledWith('backup-123');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('delete-backup', {
        success: true,
        message: 'Backup deleted successfully',
        requestId: 'test-123'
      }, mockSender);
    });

  it('should handle delete backup failure', async () => {
      const payload = { backupId: 'backup-123', requestId: 'test-123' };
      const expectedResult = {
        success: false,
        error: 'Backup not found'
      };

      mockBackupService.deleteBackup.mockResolvedValue(expectedResult);

      await deleteBackupHandler(payload, mockSender);

      expect(mockBackupService.deleteBackup).toHaveBeenCalledWith('backup-123');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('delete-backup', {
        success: false,
        error: 'Backup not found',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle download backup failure', async () => {
      const payload = {
        instanceId: 'test-instance',
        backupId: 'backup-123',
        requestId: 'test-123'
      };
      const expectedResult = {
        success: false,
        error: 'Backup not found'
      };

      mockBackupService.downloadBackup.mockResolvedValue(expectedResult);

      await downloadBackupHandler(payload, mockSender);

      expect(mockBackupService.downloadBackup).toHaveBeenCalledWith('test-instance', 'backup-123');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('download-backup', {
        success: false,
        error: 'Backup not found',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle download backup failure with undefined error', async () => {
      const payload = {
        instanceId: 'test-instance',
        backupId: 'backup-123',
        requestId: 'test-123'
      };
      const expectedResult = {
        success: false,
        error: undefined
      };

      mockBackupService.downloadBackup.mockResolvedValue(expectedResult);

      await downloadBackupHandler(payload, mockSender);

      expect(mockBackupService.downloadBackup).toHaveBeenCalledWith('test-instance', 'backup-123');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('download-backup', {
        success: false,
        error: undefined,
        requestId: 'test-123'
      }, mockSender);
    });
  });

  it('should handle get backup settings failure', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const expectedResult = {
        success: false,
        error: 'Settings not found'
      };

      mockBackupService.getBackupSettings.mockResolvedValue(expectedResult);

      await getBackupSettingsHandler(payload, mockSender);

      expect(mockBackupService.getBackupSettings).toHaveBeenCalledWith('test-instance');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-backup-settings', {
        success: false,
        error: 'Settings not found',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle get backup settings exception', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = new Error('Settings error');

      mockBackupService.getBackupSettings.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getBackupSettingsHandler(payload, mockSender);

      expect(mockBackupService.getBackupSettings).toHaveBeenCalledWith('test-instance');
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle get-backup-settings:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-backup-settings', {
        success: false,
        error: 'Settings error',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });
  });

  describe('save-backup-settings event', () => {
    it('should handle save backup settings exception with non-Error', async () => {
      const payload = {
        instanceId: 'test-instance',
        settings: {
          instanceId: 'test-instance',
          enabled: true,
          frequency: 'daily' as const,
          time: '02:00',
          maxBackupsToKeep: 5
        },
        requestId: 'test-123'
      };
      const error = 42;

      mockBackupService.saveBackupSettings.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await saveBackupSettingsHandler(payload, mockSender);

      expect(mockBackupService.saveBackupSettings).toHaveBeenCalledWith('test-instance', payload.settings);
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle save-backup-settings:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('save-backup-settings', {
        success: false,
        error: 'Failed to save backup settings',
        requestId: 'test-123'
      }, mockSender);
      consoleSpy.mockRestore();
    });
  let mockSender: any;
  beforeEach(() => { mockSender = {}; });
  it('should save backup settings successfully', async () => {
      const payload = {
        instanceId: 'test-instance',
        settings: {
          instanceId: 'test-instance',
          enabled: true,
          frequency: 'daily' as const,
          time: '02:00',
          maxBackupsToKeep: 5
        },
        requestId: 'test-123'
      };
      const expectedResult = {
        success: true,
        message: 'Settings saved successfully'
      };

      mockBackupService.saveBackupSettings.mockResolvedValue(expectedResult);

      await saveBackupSettingsHandler(payload, mockSender);

      expect(mockBackupService.saveBackupSettings).toHaveBeenCalledWith('test-instance', payload.settings);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('save-backup-settings', {
        success: true,
        message: 'Settings saved successfully',
        requestId: 'test-123'
      }, mockSender);
    });

  it('should handle save backup settings failure', async () => {
      const payload = {
        instanceId: 'test-instance',
        settings: {
          instanceId: 'test-instance',
          enabled: false,
          frequency: 'weekly' as const,
          time: '03:00',
          maxBackupsToKeep: 20
        },
        requestId: 'test-123'
      };
      const expectedResult = {
        success: false,
        error: 'Invalid settings'
      };

      mockBackupService.saveBackupSettings.mockResolvedValue(expectedResult);

      await saveBackupSettingsHandler(payload, mockSender);

      expect(mockBackupService.saveBackupSettings).toHaveBeenCalledWith('test-instance', payload.settings);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('save-backup-settings', {
        success: false,
        error: 'Invalid settings',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle save backup settings exception', async () => {
      const payload = {
        instanceId: 'test-instance',
        settings: {
          instanceId: 'test-instance',
          enabled: false,
          frequency: 'weekly' as const,
          time: '03:00',
          maxBackupsToKeep: 20
        },
        requestId: 'test-123'
      };
      const error = new Error('Save failed');

      mockBackupService.saveBackupSettings.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await saveBackupSettingsHandler(payload, mockSender);

      expect(mockBackupService.saveBackupSettings).toHaveBeenCalledWith('test-instance', payload.settings);
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle save-backup-settings:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('save-backup-settings', {
        success: false,
        error: 'Save failed',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });
  });

  describe('start-backup-scheduler event', () => {
    it('should handle start backup scheduler exception with non-Error', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = 42;

      mockBackupService.startBackupScheduler.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await startBackupSchedulerHandler(payload, mockSender);

      expect(mockBackupService.startBackupScheduler).toHaveBeenCalledWith('test-instance');
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle start-backup-scheduler:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('start-backup-scheduler', {
        success: false,
        error: 'Failed to start backup scheduler',
        requestId: 'test-123'
      }, mockSender);
      consoleSpy.mockRestore();
    });
  let mockSender: any;
  beforeEach(() => { mockSender = {}; });
  it('should start backup scheduler successfully', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const expectedResult = {
        success: true,
        message: 'Scheduler started successfully'
      };

      mockBackupService.startBackupScheduler.mockResolvedValue(expectedResult);

      await startBackupSchedulerHandler(payload, mockSender);

      expect(mockBackupService.startBackupScheduler).toHaveBeenCalledWith('test-instance');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('start-backup-scheduler', {
        success: true,
        message: 'Scheduler started successfully',
        requestId: 'test-123'
      }, mockSender);
    });

  it('should handle start backup scheduler failure', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const expectedResult = {
        success: false,
        error: 'Already running'
      };

      mockBackupService.startBackupScheduler.mockResolvedValue(expectedResult);

      await startBackupSchedulerHandler(payload, mockSender);

      expect(mockBackupService.startBackupScheduler).toHaveBeenCalledWith('test-instance');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('start-backup-scheduler', {
        success: false,
        error: 'Already running',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle start backup scheduler exception', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = new Error('Scheduler error');

      mockBackupService.startBackupScheduler.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await startBackupSchedulerHandler(payload, mockSender);

      expect(mockBackupService.startBackupScheduler).toHaveBeenCalledWith('test-instance');
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle start-backup-scheduler:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('start-backup-scheduler', {
        success: false,
        error: 'Scheduler error',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });
  });

  describe('stop-backup-scheduler event', () => {
    it('should handle stop backup scheduler exception with non-Error', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = 42;

      mockBackupService.stopBackupScheduler.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await stopBackupSchedulerHandler(payload, mockSender);

      expect(mockBackupService.stopBackupScheduler).toHaveBeenCalledWith('test-instance');
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle stop-backup-scheduler:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('stop-backup-scheduler', {
        success: false,
        error: 'Failed to stop backup scheduler',
        requestId: 'test-123'
      }, mockSender);
      consoleSpy.mockRestore();
    });
  let mockSender: any;
  beforeEach(() => { mockSender = {}; });
  it('should stop backup scheduler successfully', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const expectedResult = {
        success: true,
        message: 'Scheduler stopped successfully'
      };

      mockBackupService.stopBackupScheduler.mockResolvedValue(expectedResult);

      await stopBackupSchedulerHandler(payload, mockSender);

      expect(mockBackupService.stopBackupScheduler).toHaveBeenCalledWith('test-instance');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('stop-backup-scheduler', {
        success: true,
        message: 'Scheduler stopped successfully',
        requestId: 'test-123'
      }, mockSender);
    });

  it('should handle stop backup scheduler failure', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const expectedResult = {
        success: false,
        error: 'Not running'
      };

      mockBackupService.stopBackupScheduler.mockResolvedValue(expectedResult);

      await stopBackupSchedulerHandler(payload, mockSender);

      expect(mockBackupService.stopBackupScheduler).toHaveBeenCalledWith('test-instance');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('stop-backup-scheduler', {
        success: false,
        error: 'Not running',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle stop backup scheduler exception', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = new Error('Stop error');

      mockBackupService.stopBackupScheduler.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await stopBackupSchedulerHandler(payload, mockSender);

      expect(mockBackupService.stopBackupScheduler).toHaveBeenCalledWith('test-instance');
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle stop-backup-scheduler:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('stop-backup-scheduler', {
        success: false,
        error: 'Stop error',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });
  });

  describe('get-scheduler-status event', () => {
    it('should handle get scheduler status exception with non-Error', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = 42;

      mockBackupService.getSchedulerStatus.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getSchedulerStatusHandler(payload, mockSender);

      expect(mockBackupService.getSchedulerStatus).toHaveBeenCalledWith('test-instance');
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle get-scheduler-status:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-scheduler-status', {
        success: false,
        error: 'Failed to get scheduler status',
        requestId: 'test-123'
      }, mockSender);
      consoleSpy.mockRestore();
    });
  let mockSender: any;
  beforeEach(() => { mockSender = {}; });
  it('should get scheduler status successfully', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const expectedResult = {
        success: true,
        isRunning: true,
        nextBackup: new Date('2025-01-01T12:00:00Z')
      };

      mockBackupService.getSchedulerStatus.mockResolvedValue(expectedResult);

      await getSchedulerStatusHandler(payload, mockSender);

      expect(mockBackupService.getSchedulerStatus).toHaveBeenCalledWith('test-instance');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-scheduler-status', {
        success: true,
        isRunning: true,
        nextBackup: expectedResult.nextBackup,
        requestId: 'test-123'
      }, mockSender);
    });

  it('should handle get scheduler status failure', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const expectedResult = {
        success: false,
        error: 'Instance not found'
      };

      mockBackupService.getSchedulerStatus.mockResolvedValue(expectedResult);

      await getSchedulerStatusHandler(payload, mockSender);

      expect(mockBackupService.getSchedulerStatus).toHaveBeenCalledWith('test-instance');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-scheduler-status', {
        success: false,
        error: 'Instance not found',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle get scheduler status exception', async () => {
      const payload = { instanceId: 'test-instance', requestId: 'test-123' };
      const error = new Error('Status error');

      mockBackupService.getSchedulerStatus.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getSchedulerStatusHandler(payload, mockSender);

      expect(mockBackupService.getSchedulerStatus).toHaveBeenCalledWith('test-instance');
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle get-scheduler-status:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-scheduler-status', {
        success: false,
        error: 'Status error',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });
  });

  describe('download-backup event', () => {
  it('should handle download backup exception with non-Error', async () => {
    const payload = {
      instanceId: 'test-instance',
      backupId: 'backup-123',
      requestId: 'test-123'
    };
    const error = 42;

    mockBackupService.downloadBackup.mockRejectedValue(error);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await downloadBackupHandler(payload, mockSender);

    expect(mockBackupService.downloadBackup).toHaveBeenCalledWith('test-instance', 'backup-123');
    expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle download-backup:', error);
    expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('download-backup', {
      success: false,
      error: 'Failed to prepare backup download',
      requestId: 'test-123'
    }, mockSender);
    consoleSpy.mockRestore();
  });
    let mockSender: any;
    beforeEach(() => {
      mockSender = {};
    });
  it('should download backup successfully', async () => {
      const payload = {
        instanceId: 'test-instance',
        backupId: 'backup-123',
        requestId: 'test-123'
      };
      const expectedResult = {
        success: true,
        filePath: '/path/to/backup.zip',
        fileName: 'backup-123.zip'
      };

      mockBackupService.downloadBackup.mockResolvedValue(expectedResult);

      await downloadBackupHandler(payload, mockSender);

      expect(mockBackupService.downloadBackup).toHaveBeenCalledWith('test-instance', 'backup-123');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('download-backup', {
        success: true,
        filePath: '/path/to/backup.zip',
        fileName: 'backup-123.zip',
        requestId: 'test-123'
      }, mockSender);
    });

  it('should handle download backup failure', async () => {
    const payload = {
      instanceId: 'test-instance',
      backupId: 'backup-123',
      requestId: 'test-123'
    };
    const expectedResult = {
      success: false,
      error: 'Backup not found'
    };

    mockBackupService.downloadBackup.mockResolvedValue(expectedResult);

    await downloadBackupHandler(payload, mockSender);

    expect(mockBackupService.downloadBackup).toHaveBeenCalledWith('test-instance', 'backup-123');
    expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('download-backup', {
      success: false,
      error: 'Backup not found',
      requestId: 'test-123'
    }, mockSender);
  });

  it('should handle download backup failure with undefined error', async () => {
    const payload = {
      instanceId: 'test-instance',
      backupId: 'backup-123',
      requestId: 'test-123'
    };
    const expectedResult = {
      success: false,
      error: undefined
    };

    mockBackupService.downloadBackup.mockResolvedValue(expectedResult);

    await downloadBackupHandler(payload, mockSender);

    expect(mockBackupService.downloadBackup).toHaveBeenCalledWith('test-instance', 'backup-123');
    expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('download-backup', {
      success: false,
      error: undefined,
      requestId: 'test-123'
    }, mockSender);
  });

    it('should handle download backup exception', async () => {
      const payload = { instanceId: 'test-instance', backupId: 'backup-123', requestId: 'test-123' };
      const error = new Error('Download failed');

      mockBackupService.downloadBackup.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await downloadBackupHandler(payload, mockSender);

      expect(mockBackupService.downloadBackup).toHaveBeenCalledWith('test-instance', 'backup-123');
      expect(consoleSpy).toHaveBeenCalledWith('[backup-handler] Failed to handle download-backup:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('download-backup', {
        success: false,
        error: 'Download failed',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });
  });
