// ark-server-process.utils.ts
// Utility functions for ARK server process management

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { getPlatform } from '../../platform.utils';
import { buildArkServerArgs } from '../ark-args.utils';
import { getArkServerDir } from './ark-server-install.utils';
import { getArkExecutablePath, prepareArkServerCommand } from './ark-server-paths.utils';
import { setInstanceState, arkServerProcesses } from './ark-server-state.utils';

/**
 * Spawns the ARK server process
 */
export function spawnServerProcess(instanceId: string, instanceDir: string, config: any): { proc: any, commandInfo: any } {
  const arkExecutable = getArkExecutablePath();
  if (!fs.existsSync(arkExecutable)) {
    throw new Error('Ark server not installed');
  }

  // Build command line args from config (ensure rconPassword is used)
  const args = buildArkServerArgs({ ...config, serverAdminPassword: undefined });

  // Prepare cross-platform command
  const commandInfo = prepareArkServerCommand(arkExecutable, args);

  // Format save/config/log directories for env (use forward slashes for cross-platform compatibility)
  const formattedSaveDir = getInstanceSaveDir(instanceDir).replace(/\\/g, '/');
  const formattedConfigDir = instanceDir.replace(/\\/g, '/');
  const formattedLogDir = path.join(getArkServerDir(), 'ShooterGame', 'Saved', 'Logs').replace(/\\/g, '/');

  // Use detailed spawn options for best compatibility
  let spawnOptions: any = {
    cwd: getPlatform() === 'windows' ? instanceDir : getArkServerDir(), // Use instance dir on Windows, ARK install dir on Linux/Proton
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(commandInfo.env || {}), // Add Proton env vars on Linux
      PYTHONUNBUFFERED: '1',
      ARK_LOG_FLUSH: '1',
      _NO_DEBUG_HEAP: '1',
      MALLOC_CHECK_: '0',
      ARK_SAVE_PATH: formattedSaveDir,
      ARK_CONFIG_PATH: formattedConfigDir,
      ARK_LOG_PATH: formattedLogDir
    },
    shell: false,
    detached: getPlatform() === 'linux', // Create process group on Linux for proper cleanup
    windowsHide: true
  };

  // On Linux, prevent any stdio from attaching so no console windows are opened
  if (getPlatform() === 'linux') {
    spawnOptions.stdio = ['ignore', 'ignore', 'ignore'];
    spawnOptions.detached = true; // double-down on detaching
  }

  const proc = spawn(commandInfo.command, commandInfo.args, spawnOptions);
  arkServerProcesses[instanceId] = proc;

  return { proc, commandInfo };
}

/**
 * Sets up process event handlers
 */
export function setupProcessEventHandlers(instanceId: string, proc: any, logTail: any, onLog?: (data: string) => void, onState?: (state: string) => void): void {
  // Fallback: still capture stdout/stderr if any
  proc.stdout?.on('data', (data: Buffer) => { if (onLog) onLog('[STDOUT] ' + data.toString()); });
  proc.stderr?.on('data', (data: Buffer) => { if (onLog) onLog('[STDERR] ' + data.toString()); });

  proc.on('close', (code: number | null) => {
    if (onLog) onLog(`[PROCESS EXIT] Ark server exited with code ${code}`);
    setInstanceState(instanceId, 'stopped');
    if (onState) onState('stopped');
    delete arkServerProcesses[instanceId];
    if (logTail) logTail.close();
  });

  proc.on('error', (err: Error) => {
    if (onLog) onLog('[ERROR] ' + err.message);
    setInstanceState(instanceId, 'error');
    if (onState) onState('error');
    delete arkServerProcesses[instanceId];
    if (logTail) logTail.close();
  });
}

function getInstanceSaveDir(instanceDir: string): string {
  return path.join(instanceDir, 'SavedArks');
}
