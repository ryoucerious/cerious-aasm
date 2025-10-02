// ark-server-start.utils.ts
// Utility functions for starting ARK server instances

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { getPlatform, getDefaultInstallDir } from '../../platform.utils';
import { buildArkServerArgs } from '../ark-args.utils';
import { isPortInUse } from '../../network.utils';
import { getDefaultInstancesBaseDir, getInstancesBaseDir, loadInstanceConfig } from '../../ark/instance.utils';
import { getArkServerDir } from './ark-server-install.utils';
import { getArkExecutablePath, getArkConfigDir, prepareArkServerCommand } from './ark-server-paths.utils';
import { cleanupOldLogFiles, setupLogTailing } from './ark-server-logging.utils';
import { spawnServerProcess, setupProcessEventHandlers } from './ark-server-process.utils';
import { setInstanceState, getInstanceState, arkServerProcesses } from './ark-server-state.utils';

// --- Helper Functions ---
function generateRandomPassword(length: number) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let pwd = '';
  for (let i = 0; i < length; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

function getInstanceSaveDir(instanceDir: string): string {
  return path.join(instanceDir, 'SavedArks');
}

/**
 * Validates that required ports are available
 */
async function validateServerPorts(config: any, onLog?: (data: string) => void): Promise<{ valid: boolean, error?: string }> {
  const gamePort = config.gamePort || 7777;
  const queryPort = config.queryPort || 27015;
  const rconPort = config.rconPort || 27020;

  const gamePortInUse = await isPortInUse(gamePort);
  if (gamePortInUse) {
    const error = `Game port ${gamePort} is already in use.`;
    if (onLog) onLog(`[ERROR] ${error}`);
    return { valid: false, error };
  }

  // Only check query port if it's different from game port
  if (queryPort !== gamePort) {
    const queryPortInUse = await isPortInUse(queryPort);
    if (queryPortInUse) {
      const error = `Query port ${queryPort} is already in use.`;
      if (onLog) onLog(`[ERROR] ${error}`);
      return { valid: false, error };
    }
  }

  const rconPortInUse = await isPortInUse(rconPort);
  if (rconPortInUse) {
    const error = `RCON port ${rconPort} is already in use.`;
    if (onLog) onLog(`[ERROR] ${error}`);
    return { valid: false, error };
  }

  return { valid: true };
}

/**
 * Prepares server configuration and generates missing values
 */
function prepareServerConfig(instanceDir: string, config: any): any {
  // Generate a random RCON password if missing
  if (!config.rconPassword) {
    config.rconPassword = generateRandomPassword(16);
    // Save it back to config.json
    try {
      const configPath = path.join(instanceDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
      console.error('[ark-server-utils] Failed to save generated RCON password:', e);
    }
  }

  // Set altSaveDirectoryName to just the folder name
  // ARK will create this folder under ShooterGame/Saved/SavedArks/
  config.altSaveDirectoryName = path.join('Servers', path.basename(instanceDir), 'SavedArks');

  return config;
}

/**
 * Start an Ark server instance by instanceId. Config and save files are isolated per instance.
 * @param instanceId The unique ID of the server instance
 * @param onLog Callback for log output
 * @param onState Callback for state changes
 * @returns true if started, false if already running or not installed
 */
export async function startArkServerInstance(instanceId: string, onLog?: (data: string) => void, onState?: (state: string) => void): Promise<{ started: boolean, portError?: string }> {
  try {
    // 1. Load instance config (instance directory should already exist)
    const { instanceDir, config } = loadInstanceConfig(instanceId);

    // 2. Validate that required ports are available
    const portValidation = await validateServerPorts(config, onLog);
    if (!portValidation.valid) {
      return { started: false, portError: portValidation.error };
    }

    // 3. Clean up old log files for this session
    cleanupOldLogFiles(config, onLog);

    // 4. Prepare server configuration
    const preparedConfig = prepareServerConfig(instanceDir, config);

    // 5. Spawn the server process
    const { proc } = spawnServerProcess(instanceId, instanceDir, preparedConfig);

    // 6. Set initial state
    setInstanceState(instanceId, 'starting');
    if (onState) onState('starting');

    // 7. Setup log tailing
    const logTail = setupLogTailing(instanceId, instanceDir, preparedConfig, onLog, onState);

    // 8. Setup process event handlers
    setupProcessEventHandlers(instanceId, proc, logTail, onLog, onState);

    return { started: true };
  } catch (error) {
    console.error('[ark-server-utils] Failed to start ARK server instance:', error);
    setInstanceState(instanceId, 'error');
    if (onState) onState('error');
    return { started: false, portError: error instanceof Error ? error.message : 'Unknown error' };
  }
}