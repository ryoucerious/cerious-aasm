import { shell } from 'electron';
import { backupService } from '../services/backup/backup.service';
import { applicationService } from '../services/application.service';
import { validateInstanceId } from '../utils/validation.utils';
import { onRequest } from './handler.utils';

const INVALID_ID = { success: false, error: 'Invalid instance ID' };

export async function initializeBackupSystem(): Promise<void> {
  await backupService.initializeBackupSystem();
}

/** A successful result as `{ success: true, ...fields }`; a failed one as `{ success: false, error }`. */
function fromResult<T extends { success: boolean; error?: string }>(
  result: T,
  fields: (result: T) => Record<string, unknown>
): Record<string, unknown> {
  return result.success ? { success: true, ...fields(result) } : { success: false, error: result.error };
}

onRequest('create-backup', async payload => {
  const { instanceId, type, name } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.createBackup(instanceId, type, name);
  return fromResult(result, ({ backupId, message }) => ({ backupId, message }));
}, { fallbackError: 'Failed to create backup' });

onRequest('get-backup-list', async payload => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.getBackupList(instanceId);
  return fromResult(result, ({ backups }) => ({ backups }));
}, { fallbackError: 'Failed to get backup list' });

onRequest('restore-backup', async payload => {
  const { instanceId, backupId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.restoreBackup(instanceId, backupId);
  return fromResult(result, ({ message }) => ({ message }));
}, { fallbackError: 'Failed to restore backup' });

// Clients that send only the backup id get the first instance holding it.
onRequest('delete-backup', async payload => {
  const { backupId, instanceId } = payload;
  if (instanceId !== undefined && !validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.deleteBackup(backupId, instanceId);
  return fromResult(result, ({ message }) => ({ message }));
}, { fallbackError: 'Failed to delete backup' });

onRequest('get-backup-settings', async payload => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.getBackupSettings(instanceId);
  return fromResult(result, ({ settings }) => ({ settings }));
}, { fallbackError: 'Failed to get backup settings' });

onRequest('save-backup-settings', async payload => {
  const { instanceId, settings } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.saveBackupSettings(instanceId, settings);
  return fromResult(result, ({ message }) => ({ message }));
}, { fallbackError: 'Failed to save backup settings' });

onRequest('start-backup-scheduler', async payload => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.startBackupScheduler(instanceId);
  return fromResult(result, ({ message }) => ({ message }));
}, { fallbackError: 'Failed to start backup scheduler' });

onRequest('stop-backup-scheduler', async payload => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.stopBackupScheduler(instanceId);
  return fromResult(result, ({ message }) => ({ message }));
}, { fallbackError: 'Failed to stop backup scheduler' });

onRequest('get-scheduler-status', async payload => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.getSchedulerStatus(instanceId);
  return fromResult(result, ({ isRunning, nextBackup }) => ({ isRunning, nextBackup }));
}, { fallbackError: 'Failed to get scheduler status' });

onRequest('download-backup', async payload => {
  const { instanceId, backupId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.downloadBackup(instanceId, backupId);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  // "Download" on the desktop takes the user to the file. A headless host has no file explorer.
  let revealed = false;
  if (!applicationService.isHeadless() && result.filePath) {
    try {
      shell.showItemInFolder(result.filePath);
      revealed = true;
    } catch (error) {
      console.error('[backup-handler] Failed to reveal backup in folder:', error);
    }
  }
  return {
    success: true,
    filePath: result.filePath,
    fileName: result.fileName,
    message: revealed ? 'Backup file revealed in file explorer' : undefined
  };
}, { fallbackError: 'Failed to prepare backup download' });
