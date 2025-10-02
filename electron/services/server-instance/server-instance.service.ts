import { execSync } from 'child_process';

import * as instanceUtils from '../../utils/ark/instance.utils';
import { validateInstanceId } from '../../utils/validation.utils';
import { automationService } from '../automation/automation.service';
import { rconService } from '../rcon.service';
import { getPlatform } from '../../utils/platform.utils';
import {
  ServerInstanceResult,
  StartServerResult,
  ImportBackupResult
} from '../../types/server-instance.types';

// Import specialized services
import { serverLifecycleService } from './server-lifecycle.service';
import { serverMonitoringService } from './server-monitoring.service';
import { serverManagementService } from './server-management.service';

/**
 * Server Instance Service - Main orchestrator for server instance management operations
 * Delegates to specialized services for different concerns
 */
export class ServerInstanceService {

  /**
   * Returns the standard event callbacks for server start (log, state, rcon, player polling)
   */
  getStandardEventCallbacks(instanceId: string) {
    const messagingService = require('../messaging.service').messagingService;
    return {
      onLog: (log: string) => messagingService.sendToAll('server-instance-log', { log, instanceId }),
      onState: async (state: string) => {
        messagingService.sendToAll('server-instance-state', { state, instanceId });
        // Small delay to ensure state is properly set before broadcasting all instances
        setTimeout(async () => {
          const allInstances = await serverManagementService.getAllInstances();
          messagingService.sendToAll('server-instances', allInstances.instances);
        }, 100);
        // Handle state change for polling
        if (state === 'running') {
          serverMonitoringService.startMemoryPolling(instanceId, (instanceId: string, memory: number) => {
            messagingService.sendToAll('server-instance-memory', { instanceId, memory });
          });
          serverMonitoringService.startPlayerPolling(instanceId, (instanceId: string, count: number) => {
            messagingService.sendToAll('server-instance-players', { instanceId, count });
          });
          
          // Establish RCON connection when server is running
          setTimeout(async () => {
            try {
              const result = await require('./server-operations.service').serverOperationsService.connectRcon(instanceId);
              messagingService.sendToAll('rcon-status', {
                instanceId,
                connected: result.connected || false
              });
              if (!result.success || !result.connected) {
                console.error(`[server-instance-service] Failed to establish RCON connection for instance ${instanceId}:`, result.error);
              }
            } catch (error) {
              console.error(`[server-instance-service] Error establishing RCON connection for instance ${instanceId}:`, error);
              messagingService.sendToAll('rcon-status', {
                instanceId,
                connected: false
              });
            }
          }, 2000); // Wait 2 seconds for server to be fully ready
        } else {
          serverMonitoringService.stopMemoryPolling(instanceId);
          serverMonitoringService.stopPlayerPolling(instanceId);
        }
      }
    };
  }

  /**
   * Start a server instance with event callbacks for monitoring
   * @param instanceId - The unique identifier of the server instance to start
   * @param onLog - Callback function invoked for each log message from the server process
   * @param onStateChange - Callback function invoked when the server state changes (starting, running, stopped, etc.)
   * @returns Promise resolving to a StartServerResult indicating success/failure and any port conflicts
   */
  async startServerInstance(instanceId: string, onLog: (log: string) => void, onStateChange: (state: string) => void): Promise<StartServerResult> {
    try {
      const result = await serverLifecycleService.startArkServerInstance(instanceId, onLog, onStateChange);
      
      if (result.started) {
        // Immediately broadcast the starting state
        const messagingService = require('../messaging.service').messagingService;
        messagingService.sendToAll('server-instance-state', { state: 'starting', instanceId });
        
        // Notify automation service that server was manually started
        automationService.setManuallyStopped(instanceId, false);
      }

      // Get instance name for notifications
      const instance = await instanceUtils.getInstance(instanceId);
      const instanceName = instance?.name || instanceId;

      return {
        started: result.started,
        portError: result.portError,
        instanceId,
        instanceName
      };
    } catch (error) {
      console.error('[server-instance-service] Failed to start server instance:', error);
      return {
        started: false,
        portError: error instanceof Error ? error.message : 'Failed to start server',
        instanceId
      };
    }
  }

  /**
   * Import a server instance from a backup file, creating a new instance with the backup data
   * @param serverName - The name to assign to the newly imported server instance
   * @param backupFilePath - Optional file system path to the backup file for direct file access
   * @param fileData - Optional base64 encoded backup file data for web uploads
   * @param fileName - Optional original filename of the backup for metadata purposes
   * @returns Promise resolving to an ImportBackupResult with the new instance details or error information
   */
  async importServerFromBackup(serverName: string, backupFilePath?: string, fileData?: string, fileName?: string): Promise<ImportBackupResult> {
    try {
      if (!serverName || (!backupFilePath && !fileData)) {
        return {
          success: false,
          error: 'Server name and backup file (path or data) are required'
        };
      }

      let actualFilePath = backupFilePath;

      // If we received file data (browser environment), save it to a temporary file
      if (fileData && fileName) {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');

        try {
          // Create temporary file
          const tempDir = os.tmpdir();
          const tempFileName = `import_${Date.now()}_${fileName}`;
          actualFilePath = path.join(tempDir, tempFileName);

          // Convert base64 to buffer and save
          const buffer = Buffer.from(fileData, 'base64');
          fs.writeFileSync(actualFilePath, buffer);
        } catch (error) {
          console.error('[server-instance-service] Failed to save uploaded file:', error);
          return {
            success: false,
            error: 'Failed to save uploaded backup file'
          };
        }
      }

      // Import the backup as a new server using management service
      if (!actualFilePath) {
        return {
          success: false,
          error: 'No backup file path available'
        };
      }
      
      const result = await serverManagementService.importFromBackup(actualFilePath, serverName);

      // Clean up temporary file if we created one
      if (fileData && actualFilePath !== backupFilePath) {
        const fs = await import('fs');
        try {
          fs.unlinkSync(actualFilePath);
        } catch (cleanupError) {
          console.warn('[server-instance-service] Failed to cleanup temporary file:', cleanupError);
        }
      }

      return result;
    } catch (error: any) {
      console.error('[server-instance-service] Failed to import server from backup:', error);
      return {
        success: false,
        error: error.message || 'Failed to import server from backup'
      };
    }
  }

  // ========== PUBLIC SERVICE METHODS ==========

  /**
   * Forcefully stop a running server instance, terminating the process if necessary
   * @param instanceId - The unique identifier of the server instance to force stop
   * @returns Promise resolving to a ServerInstanceResult indicating success/failure of the stop operation
   */
  async forceStopInstance(instanceId: string): Promise<ServerInstanceResult> {
    try {
      if (!validateInstanceId(instanceId)) {
        return {
          success: false,
          error: 'Invalid instance ID'
        };
      }

      // Disconnect RCON if connected
      await rconService.forceDisconnectRcon(instanceId);

      // Kill the ARK server process for this instance
      const proc = require('./server-process.service').serverProcessService.getServerProcess(instanceId);
      if (proc && !proc.killed) {
        // For detached processes on Linux, we need special handling
        if (getPlatform() === 'linux' && proc.pid) {
          // Use process group kill for detached processes
          try {
            process.kill(-proc.pid, 'SIGKILL');
          } catch (e) {
            // Fallback to regular kill if process group kill fails
            proc.kill('SIGKILL');
          }
        } else {
          proc.kill('SIGKILL');
        }
      }

      // Update instance state
      require('./server-process.service').serverProcessService.setInstanceState(instanceId, 'stopping');

      // Get instance details for notification
      const instance = await instanceUtils.getInstance(instanceId);
      const instanceName = instance?.name || instanceId;

      return {
        success: true,
        instanceId,
        instanceName,
        shouldNotifyAutomation: true
      };
    } catch (error) {
      console.error('[server-instance-service] Failed to force stop instance:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to force stop server',
        instanceId
      };
    }
  }

  /**
   * Cleanup orphaned ARK processes on startup (moved from ark-server-utils.ts)
   * This is more aggressive than the normal cleanup and should be called on app startup
   */
  cleanupOrphanedArkProcesses(): void {    
    if (getPlatform() === 'linux') {
      try {      
        // Kill any ARK server processes
        try {
          execSync('pkill -f ArkAscendedServer', { stdio: 'ignore' });
        } catch (e) {
          // Ignore if no processes found
        }
        
        // Kill any Proton processes running ARK
        try {
          execSync('pkill -f "proton.*ArkAscendedServer"', { stdio: 'ignore' });
        } catch (e) {
          // Ignore if no processes found
        }
        
        // Kill any xvfb processes that might be stuck
        try {
          execSync('pkill -f "Xvfb.*ArkAscendedServer"', { stdio: 'ignore' });
        } catch (e) {
          // Ignore if no processes found
        }
        
        // Kill any wine processes that might be related to ARK (if somehow still present)
        try {
          execSync('pkill -f "wine.*ArkAscendedServer"', { stdio: 'ignore' });
        } catch (e) {
          // Ignore if no processes found
        }
      } catch (e) {
        console.error('[server-instance-service] Orphaned process cleanup failed:', e);
      }
    } else {
      // On Windows, use taskkill for orphaned processes
      try {
        try {
          execSync('taskkill /F /IM ArkAscendedServer.exe', { stdio: 'ignore' });
        } catch (e) {
          // Ignore if no processes found
        }
      } catch (e) {
        console.error('[server-instance-service] Windows orphaned process cleanup failed:', e);
      }
    }
  }
}

// Export singleton instance
export const serverInstanceService = new ServerInstanceService();
