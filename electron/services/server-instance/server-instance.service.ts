import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as instanceUtils from '../../utils/ark/instance.utils';
import { validateInstanceId } from '../../utils/validation.utils';
import type { DeleteInstanceResult, ImportBackupResult, ServerInstanceResult, StartServerResult } from '../../types/server-instance.types';
import { automationService } from '../automation/automation.service';
import { messagingService } from '../messaging.service';
import { mergeWithInventory, setInventoryMerge } from './inventory-merge';
import { serverLifecycleService } from './server-lifecycle.service';
import { serverManagementService } from './server-management.service';
import { serverProcessService } from './server-process.service';

export { setInventoryMerge };

export class ServerInstanceService {
  /** Starts an instance. Never rejects: a failure, a busy port included, comes back as `portError`. */
  async startServerInstance(
    instanceId: string,
    onLog: (line: string) => void,
    onState: (state: string) => void
  ): Promise<StartServerResult> {
    try {
      const instance = instanceUtils.getInstance(instanceId);
      if (!instance) {
        return { started: false, portError: 'Instance not found', instanceId };
      }

      const result = await serverLifecycleService.startServerInstance(instanceId, instance, onLog, onState);
      if (result.success) {
        messagingService.sendToAll('server-instance-state', { state: 'starting', instanceId });
        automationService.setManuallyStopped(instanceId, false);
      }
      return { started: result.success, portError: result.error, instanceId, instanceName: instance.name || instanceId };
    } catch (error) {
      console.error(`[server-instance] Failed to start ${instanceId}:`, error);
      return {
        started: false,
        portError: error instanceof Error ? error.message : 'Failed to start server',
        instanceId
      };
    }
  }

  /**
   * Creates a new instance from a backup: uploaded base64 contents, or a path on this machine,
   * which only the desktop window may give (a web user could otherwise have any zip on the host read).
   */
  async importServerFromBackup(
    serverName: string,
    backup: { filePath?: string; fileData?: string },
    fromDesktopWindow: boolean
  ): Promise<ImportBackupResult> {
    try {
      const fileData = nonEmptyText(backup.fileData);
      const filePath = nonEmptyText(backup.filePath);
      if (serverName && fileData) {
        return await this.importUpload(serverName, fileData);
      }
      if (!serverName || !filePath) {
        return { success: false, error: 'Server name and backup file (path or data) are required' };
      }
      if (!fromDesktopWindow) {
        return { success: false, error: 'Only the desktop app can import a backup by path. Upload the file instead.' };
      }
      return await serverManagementService.importFromBackup(filePath, serverName);
    } catch (error) {
      console.error('[server-instance] Failed to import server from backup:', error);
      return {
        success: false,
        error: error instanceof Error && error.message ? error.message : 'Failed to import server from backup'
      };
    }
  }

  // The client's file name is never part of the path: the upload goes to a fixed name in a
  // directory only this process knows, removed afterwards whatever happens.
  private async importUpload(serverName: string, fileData: string): Promise<ImportBackupResult> {
    let tempDir: string | undefined;
    try {
      let archivePath: string;
      try {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-import-'));
        archivePath = path.join(tempDir, 'backup.zip');
        fs.writeFileSync(archivePath, Buffer.from(fileData, 'base64'));
      } catch (error) {
        console.error('[server-instance] Failed to save the uploaded backup:', error);
        return { success: false, error: 'Failed to save uploaded backup file' };
      }
      return await serverManagementService.importFromBackup(archivePath, serverName);
    } finally {
      if (tempDir) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (error) {
          console.warn('[server-instance] Failed to remove the uploaded backup:', error);
        }
      }
    }
  }

  /** Deletes an instance, stopping its server and everything that runs on a timer for it first. */
  async deleteInstance(instanceId: string): Promise<DeleteInstanceResult> {
    // First, as the stop can take minutes: crash detection or a scheduled restart could otherwise
    // start the server again meanwhile.
    automationService.forgetInstance(instanceId);
    const result = await serverManagementService.deleteInstance(instanceId);
    if (!result.success) {
      automationService.restoreInstance(instanceId);
    }
    return result;
  }

  /** Sends the full instance list, with live state, to every client on 'server-instances'. */
  async broadcastInstances(): Promise<void> {
    const { instances } = await serverManagementService.getAllInstances();
    const merged = await mergeWithInventory(instances);
    messagingService.sendToAll('server-instances', merged);
  }

  /** Kills the server's process tree at once, with no save. */
  async forceStopInstance(instanceId: string): Promise<ServerInstanceResult> {
    try {
      if (!validateInstanceId(instanceId)) {
        return { success: false, error: 'Invalid instance ID' };
      }

      await serverProcessService.forceKillServerProcess(instanceId);

      const instanceName = instanceUtils.getInstance(instanceId)?.name || instanceId;
      return { success: true, instanceId, instanceName, shouldNotifyAutomation: true };
    } catch (error) {
      console.error(`[server-instance] Failed to force stop ${instanceId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to force stop server',
        instanceId
      };
    }
  }
}

export const serverInstanceService = new ServerInstanceService();

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
