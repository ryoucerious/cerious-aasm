import { execSync, spawn } from 'child_process';
import { getPlatform } from '../../platform.utils';
import { arkServerProcesses } from './ark-server-state.utils';

// --- Cleanup Functions ---
/**
 * Cleanup function to terminate all running ARK server processes
 * Should be called when the Electron app is shutting down
 */
export function cleanupAllArkServers(): void {  
  Object.keys(arkServerProcesses).forEach(instanceId => {
    const proc = arkServerProcesses[instanceId];
    if (proc && !proc.killed) {
      try {
        // On Linux with xvfb-run, we need to kill the entire process tree
        if (getPlatform() === 'linux') {
          // Kill the process group to ensure xvfb and all child processes are terminated
          try {
            process.kill(-proc.pid!, 'SIGTERM');
          } catch (e) {
            // If process group kill fails, try individual process
            proc.kill('SIGTERM');
          }
        } else {
          proc.kill('SIGTERM');
        }
        
        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (!proc.killed) {
            if (getPlatform() === 'linux') {
              try {
                process.kill(-proc.pid!, 'SIGKILL');
              } catch (e) {
                proc.kill('SIGKILL');
              }
              // Also clean up any remaining xvfb processes
              try {
                spawn('pkill', ['-f', `xvfb.*proton.*ArkAscendedServer`], { stdio: 'ignore' });
              } catch (e) {
                // Ignore pkill errors
              }
            } else {
              proc.kill('SIGKILL');
            }
          }
        }, 5000);
      } catch (error) {
        console.error(`[ark-server-utils] Error terminating ARK server ${instanceId}:`, error);
      }
    }
  });
  
  // Clear the processes object
  Object.keys(arkServerProcesses).forEach(key => {
    delete arkServerProcesses[key];
  });

  // On Linux, also perform system-level cleanup for any orphaned processes
  if (getPlatform() === 'linux') {
    try {      
      // Kill any remaining ARK server processes that might have been orphaned
      try {
        execSync('pkill -f ArkAscendedServer', { stdio: 'ignore' });
      } catch (e) {
        // Ignore if no processes found
      }
      
      // Kill any remaining Proton processes running ARK
      try {
        execSync('pkill -f "proton.*ArkAscendedServer"', { stdio: 'ignore' });
      } catch (e) {
        // Ignore if no processes found
      }
      
      // Kill any remaining xvfb processes that might be stuck
      try {
        execSync('pkill -f "Xvfb.*ArkAscendedServer"', { stdio: 'ignore' });
      } catch (e) {
        // Ignore if no processes found
      }
    } catch (e) {
      console.error('[ark-server-utils] System-level cleanup failed:', e);
    }
  }
}

/**
 * Cleanup orphaned ARK processes on startup (useful after crashes)
 * This is more aggressive than the normal cleanup and should be called on app startup
 */
export function cleanupOrphanedArkProcesses(): void {  
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
      console.error('[ark-server-utils] Orphaned process cleanup failed:', e);
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
      console.error('[ark-server-utils] Windows orphaned process cleanup failed:', e);
    }
  }
}