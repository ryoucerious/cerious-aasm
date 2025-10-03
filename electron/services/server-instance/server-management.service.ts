import { validateInstanceId, validateServerName, validatePort } from '../../utils/validation.utils';
import * as instanceUtils from '../../utils/ark/instance.utils';
import { backupService } from '../backup/backup.service';
import { generateRandomPassword } from '../../utils/crypto.utils';
import {
  InstancesResult,
  SingleInstanceResult,
  SaveInstanceResult,
  DeleteInstanceResult,
  ImportBackupResult
} from '../../types/server-instance.types';

/**
 * Server Management Service - Handles instance CRUD operations and backup/import operations
 */
export class ServerManagementService {
  /**
   * Get all server instances with current runtime state
   */
  async getAllInstances(): Promise<InstancesResult> {
    try {
      const instances = await instanceUtils.getAllInstances();

      // Get lifecycle and monitoring services for runtime data
      const processService = require('./server-process.service').serverProcessService;
      const monitoringService = require('./server-monitoring.service').serverMonitoringService;

      const enhancedInstances = instances.map((instance: any) => {
        const currentState = processService.getNormalizedInstanceState(instance.id);
        const process = processService.getServerProcess(instance.id);
        let memory: number | undefined;

        // Get memory usage if server is running and we have a process
        if (currentState === 'running' && process && process.pid) {
          const { getProcessMemoryUsage } = require('../../utils/platform.utils');
          memory = getProcessMemoryUsage(process.pid);
        }

        return {
          ...instance,
          state: currentState,
          memory,
          players: monitoringService.getLatestPlayerCount(instance.id)
        };
      });

      return {
        instances: enhancedInstances
      };
    } catch (error) {
      console.error('[server-management-service] Failed to get all instances:', error);
      return {
        instances: []
      };
    }
  }

  /**
   * Retrieve a single server instance by its ID
   */
  async getInstance(instanceId: string): Promise<SingleInstanceResult> {
    try {
      if (!instanceId) {
        return { instance: null };
      }

      const instance = await instanceUtils.getInstance(instanceId);
      return { instance };
    } catch (error) {
      console.error('[server-management-service] Failed to get instance:', error);
      return { instance: null };
    }
  }

  /**
   * Save or update a server instance configuration
   */
  async saveInstance(instance: any): Promise<SaveInstanceResult> {
    try {
      // Validate instance object
      if (!instance || typeof instance !== 'object') {
        return {
          success: false,
          error: 'Invalid instance object'
        };
      }

      // Validate instance ID if provided
      if (instance.id !== undefined && !validateInstanceId(instance.id)) {
        return {
          success: false,
          error: 'Invalid instance ID'
        };
      }

      // Validate instance name
      if (instance.name && !validateServerName(instance.name)) {
        return {
          success: false,
          error: 'Invalid server name'
        };
      }

      // Validate port if provided
      if (instance.port !== undefined && !validatePort(instance.port)) {
        return {
          success: false,
          error: 'Invalid port number'
        };
      }

      const saved = await instanceUtils.saveInstance(instance);
      if (saved && saved.error) {
        return {
          success: false,
          error: saved.error
        };
      }

      // Handle whitelist file generation after successful save
      if (saved && saved.id && instance.useExclusiveList) {
        try {
          const path = require('path');
          const { getInstancesBaseDir } = require('../../utils/ark/instance.utils');
          const { whitelistService } = require('../whitelist.service');
          
          const instanceDir = path.join(getInstancesBaseDir(), saved.id);
          
          // Extract player IDs from the new exclusiveJoinPlayers array
          let playerIds: string[] = [];
          if (instance.exclusiveJoinPlayers && Array.isArray(instance.exclusiveJoinPlayers)) {
            playerIds = instance.exclusiveJoinPlayers.map((player: any) => player.playerId).filter((id: string) => id && id.trim());
          } else if (instance.exclusiveJoinPlayerIds && Array.isArray(instance.exclusiveJoinPlayerIds)) {
            // Fallback to old format for backward compatibility
            playerIds = instance.exclusiveJoinPlayerIds.filter((id: string) => id && id.trim());
          }
          
          // Write whitelist file to instance directory
          const result = whitelistService.writeWhitelistFile(instanceDir, playerIds);
          if (result.success) {
            console.log(`[server-management-service] Whitelist file written for instance ${saved.id}: ${playerIds.length} players`);
          } else {
            console.warn(`[server-management-service] Failed to write whitelist file for instance ${saved.id}: ${result.error}`);
          }
        } catch (error) {
          console.error(`[server-management-service] Error writing whitelist file for instance ${saved.id}:`, error);
        }
      }

      return {
        success: true,
        instance: saved
      };
    } catch (error) {
      console.error('[server-management-service] Failed to save instance:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save instance'
      };
    }
  }

  /**
   * Delete a server instance
   */
  async deleteInstance(instanceId: string): Promise<DeleteInstanceResult> {
    try {
      if (!validateInstanceId(instanceId)) {
        return {
          success: false,
          id: instanceId
        };
      }

      // Check if instance exists
      const instance = await instanceUtils.getInstance(instanceId);
      if (!instance) {
        return {
          success: false,
          id: instanceId
        };
      }

      // Stop the server if it's running
      const lifecycleService = require('./server-lifecycle.service').serverLifecycleService;
      const monitoringService = require('./server-monitoring.service').serverMonitoringService;
      const processService = require('./server-process.service').serverProcessService;

      const currentState = processService.getNormalizedInstanceState(instanceId);
      if (['running', 'starting'].includes(currentState)) {
        await lifecycleService.stopServerInstance(instanceId);
      }

      // Stop monitoring
      monitoringService.stopPlayerPolling(instanceId);
      monitoringService.stopMemoryPolling(instanceId);

      // Delete the instance
      const deleted = await instanceUtils.deleteInstance(instanceId);
      if (!deleted) {
        return {
          success: false,
          id: instanceId
        };
      }

      return {
        success: true,
        id: instanceId
      };
    } catch (error) {
      console.error('[server-management-service] Failed to delete instance:', error);
      return {
        success: false,
        id: instanceId
      };
    }
  }

  /**
   * Create a new server instance
   */
  async createInstance(instanceData: any): Promise<SaveInstanceResult> {
    try {
      // Generate a unique ID for the new instance
      const instanceId = `instance_${Date.now()}`;

      const newInstance = {
        id: instanceId,
        ...instanceData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      return await this.saveInstance(newInstance);
    } catch (error) {
      console.error('[server-management-service] Failed to create instance:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create instance'
      };
    }
  }

  /**
   * Import a server instance from a backup
   */
  async importFromBackup(backupPath: string, instanceName: string): Promise<ImportBackupResult> {
    try {
      if (!backupPath || typeof backupPath !== 'string') {
        return {
          success: false,
          error: 'Invalid backup path'
        };
      }

      if (!instanceName || typeof instanceName !== 'string') {
        return {
          success: false,
          error: 'Invalid instance name'
        };
      }

      // Use backup service to import
      const instance = await backupService.importBackupAsNewServer(instanceName, backupPath);

      return {
        success: true,
        instance: instance
      };
    } catch (error) {
      console.error('[server-management-service] Failed to import server from backup:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to import server from backup'
      };
    }
  }

  /**
   * Prepare instance configuration (generate RCON password, write config files, copy whitelist)
   */
  async prepareInstanceConfiguration(instanceId: string, instance: any): Promise<void> {
    const path = require('path');
    const fs = require('fs');
    const { getInstancesBaseDir } = require('../../utils/ark/instance.utils');
    const { arkConfigService } = require('../ark-config.service');
    const { whitelistService } = require('../whitelist.service');
    
    const instanceDir = path.join(getInstancesBaseDir(), instanceId);
    
    // Generate a random RCON password if missing
    if (!instance.rconPassword) {
      instance.rconPassword = generateRandomPassword(16);
      // Save it back to config.json
      try {
        const configPath = path.join(instanceDir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(instance, null, 2), 'utf8');
      } catch (e) {
        console.error('[server-management-service] Failed to save generated RCON password:', e);
      }
    }

    // Write ARK configuration files (GameUserSettings.ini, Game.ini)
    try {
      arkConfigService.writeArkConfigFiles(instanceDir, instance);
      console.log(`[server-management-service] ARK config files written for instance ${instanceId}`);
    } catch (error) {
      console.error(`[server-management-service] Failed to write ARK config files for instance ${instanceId}:`, error);
    }

    // Copy whitelist file to main ARK directory (if whitelist is enabled)
    if (instance.useExclusiveList) {
      try {
        const result = whitelistService.copyWhitelistToMainDir(instanceDir);
        if (result.success) {
          console.log(`[server-management-service] Whitelist file copied for instance ${instanceId}: ${result.message}`);
        } else {
          console.warn(`[server-management-service] Failed to copy whitelist for instance ${instanceId}: ${result.error}`);
        }
      } catch (error) {
        console.error(`[server-management-service] Error copying whitelist for instance ${instanceId}:`, error);
      }
    }
  }

  /**
   * Clone an existing server instance
   */
  async cloneInstance(sourceInstanceId: string, newInstanceName: string): Promise<SaveInstanceResult> {
    try {
      if (!validateInstanceId(sourceInstanceId)) {
        return {
          success: false,
          error: 'Invalid source instance ID'
        };
      }

      if (!validateServerName(newInstanceName)) {
        return {
          success: false,
          error: 'Invalid instance name'
        };
      }

      // Get the source instance
      const sourceInstance = await instanceUtils.getInstance(sourceInstanceId);
      if (!sourceInstance) {
        return {
          success: false,
          error: 'Source instance not found'
        };
      }

      // Create a new instance based on the source
      const newInstanceId = `instance_${Date.now()}`;
      const clonedInstance = {
        ...sourceInstance,
        id: newInstanceId,
        name: newInstanceName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      return await this.saveInstance(clonedInstance);
    } catch (error) {
      console.error('[server-management-service] Failed to clone instance:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clone instance'
      };
    }
  }
}

// Export singleton instance
export const serverManagementService = new ServerManagementService();