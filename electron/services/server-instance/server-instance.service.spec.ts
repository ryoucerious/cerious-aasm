jest.mock('fs', () => ({ mkdtempSync: jest.fn(), writeFileSync: jest.fn(), rmSync: jest.fn() }));
jest.mock('os', () => ({ tmpdir: jest.fn(() => '/tmp') }));
jest.mock('../../utils/ark/instance.utils', () => ({ getInstance: jest.fn() }));
jest.mock('../automation/automation.service', () => ({
  automationService: { setManuallyStopped: jest.fn(), forgetInstance: jest.fn(), restoreInstance: jest.fn() }
}));
jest.mock('../messaging.service', () => ({ messagingService: { sendToAll: jest.fn() } }));
jest.mock('./server-lifecycle.service', () => ({ serverLifecycleService: { startServerInstance: jest.fn() } }));
jest.mock('./server-management.service', () => ({
  serverManagementService: { getAllInstances: jest.fn(), importFromBackup: jest.fn(), deleteInstance: jest.fn() }
}));
jest.mock('./server-process.service', () => ({ serverProcessService: { forceKillServerProcess: jest.fn() } }));

import * as fs from 'fs';
import * as instanceUtils from '../../utils/ark/instance.utils';
import { automationService } from '../automation/automation.service';
import { messagingService } from '../messaging.service';
import { serverLifecycleService } from './server-lifecycle.service';
import { serverManagementService } from './server-management.service';
import { serverProcessService } from './server-process.service';
import { serverInstanceService } from './server-instance.service';

const mockGetInstance = jest.mocked(instanceUtils.getInstance);
const mockLifecycle = jest.mocked(serverLifecycleService);
const mockManagement = jest.mocked(serverManagementService);
const mockProcess = jest.mocked(serverProcessService);

describe('ServerInstanceService', () => {
  const onLog = jest.fn();
  const onState = jest.fn();

  describe('startServerInstance', () => {
    it('starts the stored instance and reports it starting', async () => {
      const instance = { id: 'a1', name: 'Alpha' };
      mockGetInstance.mockReturnValue(instance);
      mockLifecycle.startServerInstance.mockResolvedValue({ success: true, instanceId: 'a1' });

      await expect(serverInstanceService.startServerInstance('a1', onLog, onState))
        .resolves.toEqual({ started: true, portError: undefined, instanceId: 'a1', instanceName: 'Alpha' });
      expect(mockLifecycle.startServerInstance).toHaveBeenCalledWith('a1', instance, onLog, onState);
      expect(messagingService.sendToAll).toHaveBeenCalledWith('server-instance-state', { state: 'starting', instanceId: 'a1' });
      expect(automationService.setManuallyStopped).toHaveBeenCalledWith('a1', false);
    });

    it('passes on a refused start', async () => {
      mockGetInstance.mockReturnValue({ id: 'a1' });
      mockLifecycle.startServerInstance.mockResolvedValue({ success: false, error: 'Game port 7777 is already in use', instanceId: 'a1' });

      await expect(serverInstanceService.startServerInstance('a1', onLog, onState))
        .resolves.toEqual({ started: false, portError: 'Game port 7777 is already in use', instanceId: 'a1', instanceName: 'a1' });
      expect(messagingService.sendToAll).not.toHaveBeenCalled();
    });

    it('reports a missing instance', async () => {
      mockGetInstance.mockReturnValue(null);

      await expect(serverInstanceService.startServerInstance('a1', onLog, onState))
        .resolves.toEqual({ started: false, portError: 'Instance not found', instanceId: 'a1' });
      expect(mockLifecycle.startServerInstance).not.toHaveBeenCalled();
    });

    it('reports an id that cannot be read', async () => {
      mockGetInstance.mockImplementationOnce(() => { throw new Error('Invalid instance ID format: ../x'); });

      await expect(serverInstanceService.startServerInstance('../x', onLog, onState))
        .resolves.toEqual({ started: false, portError: 'Invalid instance ID format: ../x', instanceId: '../x' });
    });
  });

  describe('importServerFromBackup', () => {
    const upload = { fileData: 'YmFja3Vw' };

    beforeEach(() => {
      jest.mocked(fs.mkdtempSync).mockReturnValue('/tmp/aasm-import-x1');
      mockManagement.importFromBackup.mockResolvedValue({ success: true, instance: { id: 'b2' } });
    });

    it('imports from a path on this machine for the desktop app', async () => {
      await expect(serverInstanceService.importServerFromBackup('Imported', { filePath: '/backups/a.zip' }, true))
        .resolves.toEqual({ success: true, instance: { id: 'b2' } });
      expect(mockManagement.importFromBackup).toHaveBeenCalledWith('/backups/a.zip', 'Imported');
    });

    // A path names a file on the host; a web user could have it read any zip there.
    it('refuses a path from a browser', async () => {
      await expect(serverInstanceService.importServerFromBackup('Imported', { filePath: '/backups/a.zip' }, false))
        .resolves.toEqual({ success: false, error: 'Only the desktop app can import a backup by path. Upload the file instead.' });
      expect(mockManagement.importFromBackup).not.toHaveBeenCalled();
    });

    // The client's file name used to become part of the temp path: '../..' in it wrote, then
    // deleted, a file anywhere the app could reach.
    it('writes an upload to a fixed name in a private temp directory, and removes the directory', async () => {
      await serverInstanceService.importServerFromBackup('Imported', upload, false);

      expect(fs.mkdtempSync).toHaveBeenCalledWith('/tmp/aasm-import-');
      expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/aasm-import-x1/backup.zip', Buffer.from('YmFja3Vw', 'base64'));
      expect(mockManagement.importFromBackup).toHaveBeenCalledWith('/tmp/aasm-import-x1/backup.zip', 'Imported');
      expect(fs.rmSync).toHaveBeenCalledWith('/tmp/aasm-import-x1', { recursive: true, force: true });
    });

    it('prefers the upload when a browser sends a path as well', async () => {
      await serverInstanceService.importServerFromBackup('Imported', { ...upload, filePath: 'C:\\Windows\\x.zip' }, false);

      expect(mockManagement.importFromBackup).toHaveBeenCalledWith('/tmp/aasm-import-x1/backup.zip', 'Imported');
    });

    it('removes the temp directory when the import throws', async () => {
      mockManagement.importFromBackup.mockRejectedValueOnce(new Error('Import failed'));

      await expect(serverInstanceService.importServerFromBackup('Imported', upload, false))
        .resolves.toEqual({ success: false, error: 'Import failed' });
      expect(fs.rmSync).toHaveBeenCalledWith('/tmp/aasm-import-x1', { recursive: true, force: true });
    });

    it('reports an upload it could not save, and removes the temp directory', async () => {
      jest.mocked(fs.writeFileSync).mockImplementationOnce(() => { throw new Error('ENOSPC'); });

      await expect(serverInstanceService.importServerFromBackup('Imported', upload, false))
        .resolves.toEqual({ success: false, error: 'Failed to save uploaded backup file' });
      expect(fs.rmSync).toHaveBeenCalledWith('/tmp/aasm-import-x1', { recursive: true, force: true });
    });

    it.each([
      ['no name', '', { filePath: '/backups/a.zip' }],
      ['no file', 'Imported', {}],
      ['upload data that is not text', 'Imported', { fileData: 42 }]
    ])('refuses a request with %s', async (_label, serverName, backup) => {
      await expect(serverInstanceService.importServerFromBackup(serverName, backup as never, true))
        .resolves.toEqual({ success: false, error: 'Server name and backup file (path or data) are required' });
      expect(mockManagement.importFromBackup).not.toHaveBeenCalled();
    });
  });

  // Crash detection and a scheduled restart used to outlive a deleted instance, and could start it
  // again during the minutes its stop takes.
  describe('deleteInstance', () => {
    it('stops the instance\'s automation before deleting it', async () => {
      mockManagement.deleteInstance.mockResolvedValue({ success: true, id: 'a1' });

      await expect(serverInstanceService.deleteInstance('a1')).resolves.toEqual({ success: true, id: 'a1' });

      expect(automationService.forgetInstance).toHaveBeenCalledWith('a1');
      expect(jest.mocked(automationService.forgetInstance).mock.invocationCallOrder[0])
        .toBeLessThan(mockManagement.deleteInstance.mock.invocationCallOrder[0]);
      expect(automationService.restoreInstance).not.toHaveBeenCalled();
    });

    it('gives the instance its automation back when the delete fails', async () => {
      mockManagement.deleteInstance.mockResolvedValue({ success: false, id: 'a1' });

      await expect(serverInstanceService.deleteInstance('a1')).resolves.toEqual({ success: false, id: 'a1' });

      expect(automationService.restoreInstance).toHaveBeenCalledWith('a1');
    });
  });

  describe('broadcastInstances', () => {
    it('sends the full instance list to every client', async () => {
      const instances = [{ id: 'a1', name: 'Alpha' }];
      mockManagement.getAllInstances.mockResolvedValue({ instances });

      await serverInstanceService.broadcastInstances();

      expect(messagingService.sendToAll).toHaveBeenCalledWith('server-instances', instances);
    });
  });

  describe('forceStopInstance', () => {
    it('force-kills the server', async () => {
      mockGetInstance.mockReturnValue({ id: 'a1', name: 'Alpha' });

      await expect(serverInstanceService.forceStopInstance('a1'))
        .resolves.toEqual({ success: true, instanceId: 'a1', instanceName: 'Alpha', shouldNotifyAutomation: true });
      expect(mockProcess.forceKillServerProcess).toHaveBeenCalledWith('a1');
    });

    it('refuses an invalid id', async () => {
      await expect(serverInstanceService.forceStopInstance('../x')).resolves.toEqual({ success: false, error: 'Invalid instance ID' });
      expect(mockProcess.forceKillServerProcess).not.toHaveBeenCalled();
    });

    it('reports a kill that fails', async () => {
      mockProcess.forceKillServerProcess.mockRejectedValueOnce(new Error('Kill failed'));

      await expect(serverInstanceService.forceStopInstance('a1'))
        .resolves.toEqual({ success: false, error: 'Kill failed', instanceId: 'a1' });
    });
  });
});
