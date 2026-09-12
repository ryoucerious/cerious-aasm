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
// =========================
// Host resource sampling (dashboard)
// =========================

/** A snapshot of aggregate CPU time across all cores, used to derive a usage percentage. */
export interface CpuTimeSample {
  idle: number;
  total: number;
}

/**
 * Sample the aggregate CPU times of every core. Two samples a short interval apart give a
 * usage percentage via {@link cpuPercentFromSamples}; a single sample on its own is meaningless
 * because os.cpus() reports cumulative time since boot.
 */
export function sampleCpuTimes(): CpuTimeSample {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.irq + times.idle;
  }
  return { idle, total };
}

/**
 * Turn two CPU time samples into a busy percentage (0-100). Returns 0 when the samples are
 * identical (no elapsed time) so callers never divide by zero.
 */
export function cpuPercentFromSamples(first: CpuTimeSample, second: CpuTimeSample): number {
  const totalDelta = second.total - first.total;
  const idleDelta = second.idle - first.idle;
  if (totalDelta <= 0) return 0;
  const busy = 1 - idleDelta / totalDelta;
  return Math.max(0, Math.min(100, Math.round(busy * 1000) / 10));
}

/**
 * Disk usage of the volume containing `targetPath`, in bytes. Returns null when the platform
 * tooling is unavailable, so the dashboard can show a placeholder instead of a wrong number.
 * Electron 21 ships Node 16, which has no fs.statfs, hence the shell fallbacks.
 */
export function getDiskUsage(targetPath: string): { total: number; free: number } | null {
  try {
    const platform = getPlatform();
    if (platform === 'windows') {
      const resolved = path.resolve(targetPath || os.homedir());
      const drive = resolved.slice(0, 2); // e.g. "C:"
      if (!/^[A-Za-z]:$/.test(drive)) return null;
      const command = `powershell -NoProfile -NonInteractive -Command "$d = Get-PSDrive -Name '${drive[0]}'; Write-Output ($d.Used + $d.Free); Write-Output $d.Free"`;
      const output = execSync(command, { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const [totalStr, freeStr] = output.trim().split(/\r?\n/);
      const total = Number(totalStr);
      const free = Number(freeStr);
      if (!Number.isFinite(total) || !Number.isFinite(free) || total <= 0) return null;
      return { total, free };
    }
    // Linux: POSIX df output in 1K blocks
    const output = execSync(`df -kP "${targetPath || os.homedir()}"`, { encoding: 'utf8', timeout: 5000 });
    const lines = output.trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const cols = lines[lines.length - 1].trim().split(/\s+/);
    // Filesystem 1K-blocks Used Available Use% Mounted
    const totalKb = Number(cols[1]);
    const availKb = Number(cols[3]);
    if (!Number.isFinite(totalKb) || !Number.isFinite(availKb) || totalKb <= 0) return null;
    return { total: totalKb * 1024, free: availKb * 1024 };
  } catch (error) {
    console.debug('[platform-utils] Failed to read disk usage:', error);
    return null;
  }
}

/**
 * Cumulative CPU seconds consumed by a process. Sampling twice and dividing the delta by the
 * elapsed wall time and core count gives a percentage — see ServerMonitoringService.
 * Returns null when it cannot be determined (process gone, tooling missing).
 */
export function getProcessCpuSeconds(pid: number): number | null {
  try {
    const platform = getPlatform();
    if (platform === 'windows') {
      const command = `powershell -NoProfile -NonInteractive -Command "(Get-Process -Id ${pid} -ErrorAction Stop).TotalProcessorTime.TotalSeconds"`;
      const output = execSync(command, { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const seconds = parseFloat(output.trim().replace(',', '.'));
      return Number.isFinite(seconds) ? seconds : null;
    }
    // Linux: fields 14 (utime) and 15 (stime) of /proc/<pid>/stat, in clock ticks
    const stat = require('fs').readFileSync(`/proc/${pid}/stat`, 'utf8') as string;
    // The command name is in parentheses and may contain spaces; split after the last ')'.
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const utime = Number(afterComm[11]);
    const stime = Number(afterComm[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
    let ticksPerSecond = 100;
    try {
      const out = execSync('getconf CLK_TCK', { encoding: 'utf8', timeout: 2000 }).trim();
      const parsed = Number(out);
      if (Number.isFinite(parsed) && parsed > 0) ticksPerSecond = parsed;
    } catch {
      // keep the Linux default of 100
    }
    return (utime + stime) / ticksPerSecond;
  } catch (error) {
    console.debug(`[platform-utils] Failed to read CPU time for PID ${pid}:`, error);
    return null;
  }
}

/**
 * Convert two process CPU-second samples into a percentage of total machine capacity
 * (0-100 across all cores), so a fully loaded single core on a 16-core box reads 6.25%.
 */
export function processCpuPercent(firstSeconds: number, secondSeconds: number, elapsedMs: number, coreCount?: number): number {
  const cores = coreCount && coreCount > 0 ? coreCount : Math.max(1, os.cpus().length);
  if (elapsedMs <= 0) return 0;
  const cpuDelta = Math.max(0, secondSeconds - firstSeconds);
  const percent = (cpuDelta / (elapsedMs / 1000)) / cores * 100;
  return Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
}
