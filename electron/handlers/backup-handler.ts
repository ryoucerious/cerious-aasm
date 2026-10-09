import { shell } from 'electron';
import { backupService } from '../services/backup/backup.service';
import { applicationService } from '../services/application.service';
import { validateInstanceId } from '../utils/validation.utils';
import { onRequest } from './handler.utils';
import { backupCopies } from '../services/backup/backup-copies.service';
import { meshService } from '../services/mesh/mesh-service';
import { identifySender } from '../services/auth/permission-gate';
import { registerForwardable } from '../services/host-routing';

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
}, { fallbackError: 'Failed to create backup', host: { idKey: 'instanceId' } });

onRequest('get-backup-list', async payload => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.getBackupList(instanceId);
  return fromResult(result, ({ backups }) => ({ backups }));
}, { fallbackError: 'Failed to get backup list', host: { idKey: 'instanceId', read: true } });

onRequest('restore-backup', async payload => {
  const { instanceId, backupId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.restoreBackup(instanceId, backupId);
  return fromResult(result, ({ message }) => ({ message }));
}, { fallbackError: 'Failed to restore backup', host: { idKey: 'instanceId' } });

// Clients that send only the backup id get the first instance holding it.
onRequest('delete-backup', async payload => {
  const { backupId, instanceId } = payload;
  if (instanceId !== undefined && !validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.deleteBackup(backupId, instanceId);
  return fromResult(result, ({ message }) => ({ message }));
}, { fallbackError: 'Failed to delete backup', host: { idKey: 'instanceId' } });

onRequest('get-backup-settings', async payload => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.getBackupSettings(instanceId);
  return fromResult(result, ({ settings }) => ({ settings }));
}, { fallbackError: 'Failed to get backup settings', host: { idKey: 'instanceId', read: true } });

onRequest('save-backup-settings', async payload => {
  const { instanceId, settings } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.saveBackupSettings(instanceId, settings);
  return fromResult(result, ({ message }) => ({ message }));
}, { fallbackError: 'Failed to save backup settings', host: { idKey: 'instanceId' } });

onRequest('start-backup-scheduler', async payload => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.startBackupScheduler(instanceId);
  return fromResult(result, ({ message }) => ({ message }));
}, { fallbackError: 'Failed to start backup scheduler', host: { idKey: 'instanceId' } });

onRequest('stop-backup-scheduler', async payload => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.stopBackupScheduler(instanceId);
  return fromResult(result, ({ message }) => ({ message }));
}, { fallbackError: 'Failed to stop backup scheduler', host: { idKey: 'instanceId' } });

onRequest('get-scheduler-status', async payload => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const result = await backupService.getSchedulerStatus(instanceId);
  return fromResult(result, ({ isRunning, nextBackup }) => ({ isRunning, nextBackup }));
}, { fallbackError: 'Failed to get scheduler status', host: { idKey: 'instanceId', read: true } });

onRequest('download-backup', async payload => {
  const { instanceId, backupId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  // A server on another machine: its backup is fetched here first, to be shown like one of this machine's.
  const fetched = await meshService.fetchBackupForDownload(instanceId, backupId);
  const result = fetched ?? await backupService.downloadBackup(instanceId, backupId);
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

// The latest backup of each server is kept on another machine of the mesh too: where it is,
// asked of the machine hosting the server.
onRequest('get-backup-copy', async payload => {
  const { instanceId } = payload;
  const remote = await meshService.queryRemote<{ copy?: unknown }>(instanceId, 'backup-copy');
  if (remote) return { copy: remote.copy ?? null };
  return { copy: backupCopies.sent(instanceId) };
}, { fallbackError: 'Could not find where the backup copy is' });

// Brings the copy back into the server's backups, on the machine hosting it, to restore from.
onRequest('fetch-backup-copy', async (payload, { sender }) => {
  const { instanceId } = payload;
  const actor = identifySender(sender).user?.username || 'desktop';
  const remote = await meshService.forwardIfRemote('fetch-backup-copy', instanceId, actor);
  const result = remote ?? await meshService.fetchBackupCopy(instanceId);
  return result.success ? { success: true } : { success: false, error: result.error };
}, { fallbackError: 'Could not bring the backup copy back' });

/** The copies this machine keeps of servers on other machines. */
onRequest('list-held-backup-copies', () => ({ copies: backupCopies.list() }), { fallbackError: 'Could not list the backup copies' });

// Asked by another machine fetching one of this machine's backups to download: which file it is.
registerForwardable('locate-backup', true, async payload => {
  const instanceId = String(payload.instanceId || '');
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const located = await backupService.downloadBackup(instanceId, String(payload.backupId || ''));
  return located.success ? { success: true, fileName: located.fileName } : { success: false, error: located.error };
});
