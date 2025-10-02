import type { App } from 'electron';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Platform Detection and Path Utilities
 * Consolidated from os-utils.ts and lean-os-utils.ts
 */

/**
 * Get the current platform
 * @returns 'windows' | 'linux'
 */
export function getPlatform(): 'windows' | 'linux' {
  const platform = process.platform;
  if (platform === 'win32') return 'windows';
  if (platform === 'linux') return 'linux';
  // Only Windows and Linux are supported
  throw new Error(`Only Windows and Linux are supported. Current platform: ${platform}`);
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return getPlatform() === 'windows';
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return getPlatform() === 'linux';
}

/**
 * Get the default installation directory based on platform
 */
export function getDefaultInstallDir(): string {
  const platform = getPlatform();
  if (platform === 'windows') {
    return path.join(process.env.APPDATA || os.homedir(), 'Cerious AASM');
  } else if (platform === 'linux') {
    return path.join(os.homedir(), '.local', 'share', 'cerious-aasm');
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * Get the user data path for Electron app
 */
export function getUserDataPath(app: App): string {
  const platform = getPlatform();
  if (platform === 'windows') {
    return path.join(app.getPath('appData'), 'Cerious AASM');
  } else if (platform === 'linux') {
    return path.join(os.homedir(), '.local', 'share', 'cerious-aasm');
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * Get the home directory path
 */
export function getHomeDir(): string {
  return os.homedir();
}

/**
 * Get the temporary directory path
 */
export function getTempDir(): string {
  return os.tmpdir();
}

/**
 * Get system architecture
 */
export function getArchitecture(): string {
  return os.arch();
}

/**
 * Get total system memory in bytes
 */
export function getTotalMemory(): number {
  return os.totalmem();
}

/**
 * Get free system memory in bytes
 */
export function getFreeMemory(): number {
  return os.freemem();
}

/**
 * Get process memory usage in MB
 * @param pid - Process ID
 * @returns Memory usage in MB, or null if unable to determine
 */
export function getProcessMemoryUsage(pid: number): number | null {
  try {
    const platform = getPlatform();

    if (platform === 'windows') {
      // Use tasklist command on Windows
      const output = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' });

      // Parse CSV output: "Image Name","PID","Session Name","Session#","Mem Usage"
      // Use split by '","' to handle commas in the memory field
      const parts = output.split('","');
      if (parts.length >= 5) {
        // The memory is in the last part
        const memoryStr = parts[parts.length - 1].replace(/"/g, '').trim();
        const memUsageKB = parseFloat(memoryStr.replace(/,/g, '').replace(' K', ''));
        if (!isNaN(memUsageKB)) {
          return Math.round(memUsageKB / 1024); // Convert KB to MB
        }
      }
    } else if (platform === 'linux') {
      // Memory usage calculation for Proton/Wine processes on Linux is unreliable
      // Return null to indicate memory usage cannot be accurately determined
      return null;
    }

    return null;
  } catch (error) {
    console.error(`[platform-utils] Failed to get memory usage for PID ${pid}:`, error);
    return null;
  }
}

/**
 * Get CPU information
 */
export function getCpuInfo(): os.CpuInfo[] {
  return os.cpus();
}

/**
 * Get system uptime in seconds
 */
export function getUptime(): number {
  return os.uptime();
}

/**
 * Get network interfaces
 */
export function getNetworkInterfaces(): NodeJS.Dict<os.NetworkInterfaceInfo[]> {
  return os.networkInterfaces();
}

/**
 * Get environment-specific paths
 */
export function getEnvironmentPaths() {
  return {
    home: getHomeDir(),
    temp: getTempDir(),
    installDir: getDefaultInstallDir(),
    platform: getPlatform(),
    arch: getArchitecture()
  };
}