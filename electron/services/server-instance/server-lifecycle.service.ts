import { ChildProcess, spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { validateInstanceId } from '../../utils/validation.utils';
import { ArkPathUtils, ArkCommandUtils, buildArkServerArgs } from '../../utils/ark.utils';
import { isPortInUse } from '../../utils/network.utils';
import { getPlatform } from '../../utils/platform.utils';
import { rconService } from '../rcon.service';
import { ServerInstanceResult } from '../../types/server-instance.types';

/**
 * Server Lifecycle Service - Handles server start, stop, and restart operations
 */
export class ServerLifecycleService {

  /**
   * Start ARK server instance
   */
  async startServerInstance(
    instanceId: string,
    instance: any,
    onLog?: (data: string) => void,
    onState?: (state: string) => void
  ): Promise<ServerInstanceResult> {
    try {
      // Validate prerequisites
      const validationResult = await this.validateStartPrerequisites(instanceId, instance);
      if (!validationResult.success) {
        return validationResult;
      }

      // Prepare instance configuration
      const managementService = require('./server-management.service').serverManagementService;
      await managementService.prepareInstanceConfiguration(instanceId, instance);

      // Start the server process
      const processService = require('./server-process.service').serverProcessService;
      const processResult = await processService.startServerProcess(instanceId, instance);
      if (!processResult.success) {
        return processResult;
      }

      // Set up monitoring and event handling
      processService.setupProcessMonitoring(instanceId, instance, onLog, onState);

      return {
        success: true,
        instanceId
      };

    } catch (error) {
      console.error(`[server-lifecycle-service] Failed to start ARK server instance ${instanceId}:`, error);
      const processService = require('./server-process.service').serverProcessService;
      processService.setInstanceState(instanceId, 'error');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start server instance',
        instanceId
      };
    }
  }

  /**
   * Validate all prerequisites before starting a server instance
   */
  private async validateStartPrerequisites(instanceId: string, instance: any): Promise<ServerInstanceResult> {
    if (!validateInstanceId(instanceId)) {
      return {
        success: false,
        error: 'Invalid instance ID',
        instanceId
      };
    }

    // Check if ARK server is installed
    const arkExecutablePath = ArkPathUtils.getArkExecutablePath();
    if (!fs.existsSync(arkExecutablePath)) {
      return {
        success: false,
        error: 'ARK server is not installed',
        instanceId
      };
    }

    // Check if instance is already running
    const processService = require('./server-process.service').serverProcessService;
    const currentState = processService.getNormalizedInstanceState(instanceId);
    if (['starting', 'running'].includes(currentState)) {
      return {
        success: false,
        error: 'Instance is already running or starting',
        instanceId
      };
    }

    // Validate ports
    return await this.validateInstancePorts(instance, instanceId);
  }

  /**
   * Validate that required ports are available
   */
  private async validateInstancePorts(instance: any, instanceId: string): Promise<ServerInstanceResult> {
    const gamePort = parseInt(instance.gamePort);
    const queryPort = parseInt(instance.queryPort);
    const rconPort = parseInt(instance.rconPort);

    if (await isPortInUse(gamePort)) {
      return {
        success: false,
        error: `Game port ${gamePort} is already in use`,
        instanceId
      };
    }
    if (await isPortInUse(queryPort)) {
      return {
        success: false,
        error: `Query port ${queryPort} is already in use`,
        instanceId
      };
    }
    if (await isPortInUse(rconPort)) {
      return {
        success: false,
        error: `RCON port ${rconPort} is already in use`,
        instanceId
      };
    }

    return { success: true, instanceId };
  }

  /**
   * Stop ARK server instance
   */
  async stopServerInstance(instanceId: string): Promise<ServerInstanceResult> {
    const processService = require('./server-process.service').serverProcessService;
    return await processService.stopServerProcess(instanceId);
  }

  /**
   * Restart ARK server instance
   */
  async restartServerInstance(
    instanceId: string,
    instance: any,
    onLog?: (data: string) => void,
    onState?: (state: string) => void
  ): Promise<ServerInstanceResult> {
    try {
      // Stop the server first
      const stopResult = await this.stopServerInstance(instanceId);
      if (!stopResult.success) {
        return stopResult;
      }

      // Wait a moment before restarting
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Start the server again
      return await this.startServerInstance(instanceId, instance, onLog, onState);

    } catch (error) {
      console.error(`[server-lifecycle-service] Failed to restart ARK server instance ${instanceId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restart server instance',
        instanceId
      };
    }
  }

  /**
   * Cleanup orphaned ARK processes on startup
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
        console.error('[server-lifecycle-service] Orphaned process cleanup failed:', e);
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
        console.error('[server-lifecycle-service] Windows orphaned process cleanup failed:', e);
      }
    }
  }

  /**
   * Start ARK server instance (legacy method for backward compatibility)
   */
  async startArkServerInstance(
    instanceId: string,
    onLog?: (data: string) => void,
    onState?: (state: string) => void
  ): Promise<{ started: boolean, portError?: string }> {
    const instance = require('../../utils/ark/instance.utils').getInstance(instanceId);
    if (!instance) {
      return { started: false, portError: 'Instance not found' };
    }

    const result = await this.startServerInstance(instanceId, instance, onLog, onState);
    return {
      started: result.success,
      portError: result.error
    };
  }

  // ====================================================================
  // Feature #7: Cluster Control (Start/Stop All)
  // ====================================================================

  /**
   * Start all server instances with staggered delay to prevent CPU overload
   */
  async startAllInstances(delayMs = 30000): Promise<{ started: string[], failed: string[] }> {
    const managementService = require('./server-management.service').serverManagementService;
    const processService = require('./server-process.service').serverProcessService;
    
    const instances = (await managementService.getAllInstances()).instances;
    const started: string[] = [];
    const failed: string[] = [];

    for (const instance of instances) {
        const state = processService.getNormalizedInstanceState(instance.id);
        if (state !== 'running' && state !== 'starting') {
            try {
                console.log(`[Lifecycle] Starting instance ${instance.id} as part of Start All...`);
                // Use standard callback hooks
                const callbacks = require('./server-instance.service').serverInstanceService.getStandardEventCallbacks(instance.id);
                
                await this.startServerInstance(instance.id, instance, callbacks.onLog, callbacks.onState);
                started.push(instance.id);
                
                // Stagger delay
                await new Promise(resolve => setTimeout(resolve, delayMs));
            } catch (e) {
                console.error(`[Lifecycle] Failed to start ${instance.id}:`, e);
                failed.push(instance.id);
            }
        }
    }
    return { started, failed };
  }

  /**
   * Stop all running server instances in parallel
   */
  async stopAllInstances(): Promise<{ stopped: string[], failed: string[] }> {
    const managementService = require('./server-management.service').serverManagementService;
    const processService = require('./server-process.service').serverProcessService;
    
    const instances = (await managementService.getAllInstances()).instances;
    const stopped: string[] = [];
    const failed: string[] = [];

    const stopPromises = instances.map(async (instance: any) => {
        const state = processService.getNormalizedInstanceState(instance.id);
        if (state === 'running' || state === 'starting') {
            try {
                console.log(`[Lifecycle] Stopping instance ${instance.id} as part of Stop All...`);
                await this.stopServerInstance(instance.id);
                stopped.push(instance.id);
            } catch (e) {
                console.error(`[Lifecycle] Failed to stop ${instance.id}:`, e);
                failed.push(instance.id);
            }
        }
    });

    await Promise.all(stopPromises);
    return { stopped, failed };
  }
}

// Export singleton instance
export const serverLifecycleService = new ServerLifecycleService();