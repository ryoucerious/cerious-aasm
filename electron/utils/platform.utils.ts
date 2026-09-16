import type { App } from 'electron';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, execFile } from 'child_process';

/**
 * Options shared by every metrics subprocess: never flash a console window, and never let a
 * wedged command hold a poll open forever.
 */
const METRICS_EXEC_OPTIONS = { encoding: 'utf8' as const, windowsHide: true, timeout: 5000 };

/**
 * Promise wrapper around execFile that resolves to stdout.
 *
 * Every metrics command below is async on purpose. They used to run through execSync, which
 * froze the Electron main process for the duration — tolerable at a few milliseconds, but the
 * PowerShell calls this replaced cost ~400ms on an SSD and multiple seconds on a mechanical
 * drive under server load, which is what made the UI lock up.
 *
 * Hand-rolled rather than util.promisify so the callback shape is explicit and easy to mock.
 */
function execFileAsync(file: string, args: string[], options: object = METRICS_EXEC_OPTIONS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error: Error | null, stdout: string | Buffer) => {
      if (error) reject(error);
      else resolve(typeof stdout === 'string' ? stdout : stdout.toString());
    });
  });
}

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

export interface ProcessStats {
  /** Resident memory in MB, or null when it cannot be determined. */
  memoryMb: number | null;
  /** Cumulative CPU seconds consumed by the process, or null when unavailable. */
  cpuSeconds: number | null;
}

const PROCESS_STATS_TTL_MS = 2000;
const processStatsCache = new Map<number, { at: number; value: Promise<ProcessStats | null> }>();

/**
 * Memory and cumulative CPU time for a PID.
 *
 * On Windows both come from a single `tasklist /V` call: the /V flag adds the CPU Time column,
 * so one cheap native spawn answers both the memory poll and the CPU poll instead of one each —
 * and neither needs PowerShell. On Linux memory is left null (unreliable for Proton/Wine
 * process trees) and CPU comes from /proc, with no subprocess at all.
 *
 * Results are memoised briefly because the memory poll (60s) and CPU poll (10s) run on separate
 * timers and regularly land on the same tick.
 */
export function getProcessStats(pid: number): Promise<ProcessStats | null> {
  const cached = processStatsCache.get(pid);
  if (cached && Date.now() - cached.at < PROCESS_STATS_TTL_MS) return cached.value;

  const value = readProcessStats(pid).catch(error => {
    console.debug(`[platform-utils] Failed to read process stats for PID ${pid}:`, error);
    return null;
  });
  processStatsCache.set(pid, { at: Date.now(), value });
  pruneProcessStatsCache();
  return value;
}

/**
 * Drop memoised readings so the next call re-reads. Useful when a process has just started or
 * stopped and a stale sample would be misleading.
 */
export function clearProcessStatsCache(pid?: number): void {
  if (pid === undefined) processStatsCache.clear();
  else processStatsCache.delete(pid);
}

/** Drop expired entries so the map does not grow with every PID the app has ever polled. */
function pruneProcessStatsCache(): void {
  if (processStatsCache.size <= 64) return;
  const now = Date.now();
  const stale: number[] = [];
  processStatsCache.forEach((entry, key) => {
    if (now - entry.at >= PROCESS_STATS_TTL_MS) stale.push(key);
  });
  stale.forEach(key => processStatsCache.delete(key));
}

async function readProcessStats(pid: number): Promise<ProcessStats | null> {
  if (getPlatform() !== 'windows') {
    return { memoryMb: null, cpuSeconds: readLinuxCpuSeconds(pid) };
  }
  const output = await execFileAsync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH', '/V']);
  return parseTasklistVerbose(output);
}

/**
 * Parse one `tasklist /FO CSV /NH /V` row.
 *
 * Columns: Image Name, PID, Session Name, Session#, Mem Usage, Status, User Name, CPU Time,
 * Window Title. Splitting on `","` is safe because that separator only ever appears between
 * fields — the thousands separator inside a value like "227,312 K" is never adjacent to a quote.
 */
export function parseTasklistVerbose(output: string): ProcessStats | null {
  // A missing PID yields "INFO: No tasks are running which match..." with no quoted row.
  const row = output.split(/\r?\n/).find(line => line.trim().startsWith('"'));
  if (!row) return null;

  const fields = row.trim().split('","');
  if (fields.length < 8) return null;

  // Strip every non-digit rather than just commas: the thousands separator is localised.
  const memoryKb = Number(fields[4].replace(/[^\d]/g, ''));
  const memoryMb = Number.isFinite(memoryKb) && memoryKb > 0 ? Math.round(memoryKb / 1024) : null;

  return { memoryMb, cpuSeconds: parseCpuTime(fields[7]) };
}

/** Convert tasklist's `h:mm:ss` CPU time (hours accumulate past 24) to seconds. */
function parseCpuTime(value: string): number | null {
  const parts = value.replace(/"/g, '').trim().split(':');
  if (parts.length !== 3) return null;
  const [hours, minutes, seconds] = parts.map(Number);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/** Clock ticks per second never change for the life of the process, so resolve them once. */
let linuxTicksPerSecond: number | null = null;
function getLinuxTicksPerSecond(): number {
  if (linuxTicksPerSecond !== null) return linuxTicksPerSecond;
  try {
    const parsed = Number(execSync('getconf CLK_TCK', { encoding: 'utf8', timeout: 2000 }).trim());
    linuxTicksPerSecond = Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
  } catch {
    linuxTicksPerSecond = 100;
  }
  return linuxTicksPerSecond;
}

/** Fields 14 (utime) and 15 (stime) of /proc/<pid>/stat, in clock ticks. */
function readLinuxCpuSeconds(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The command name is in parentheses and may contain spaces; split after the last ')'.
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const utime = Number(afterComm[11]);
    const stime = Number(afterComm[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
    return (utime + stime) / getLinuxTicksPerSecond();
  } catch (error) {
    console.debug(`[platform-utils] Failed to read /proc CPU time for PID ${pid}:`, error);
    return null;
  }
}

/**
 * Get process memory usage in MB
 * @param pid - Process ID
 * @returns Memory usage in MB, or null if unable to determine
 */
export async function getProcessMemoryUsage(pid: number): Promise<number | null> {
  const stats = await getProcessStats(pid);
  return stats ? stats.memoryMb : null;
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
const DISK_CACHE_TTL_MS = 60000;

let diskReading: { key: string; at: number; value: DiskUsage | null } | null = null;
let diskInFlight: { key: string; promise: Promise<DiskUsage | null> } | null = null;

/** Volume capacity cannot change while the app runs, so it is resolved once per drive. */
const driveCapacityCache = new Map<string, number>();

export interface DiskUsage {
  total: number;
  free: number;
}

export function getDiskUsage(targetPath: string): Promise<DiskUsage | null> {
  const key = targetPath || '';

  // Free space does not move meaningfully between 5-second dashboard polls, so serve a cached
  // reading rather than shelling out on every tick.
  if (diskReading && diskReading.key === key && Date.now() - diskReading.at < DISK_CACHE_TTL_MS) {
    return Promise.resolve(diskReading.value);
  }

  // Single-flight: if a slow disk stalls one read, later polls join it instead of stacking up
  // more subprocesses behind it, which is what turned a slow drive into a spiral.
  if (diskInFlight && diskInFlight.key === key) return diskInFlight.promise;

  const promise = readDiskUsage(targetPath)
    .catch(error => {
      console.debug('[platform-utils] Failed to read disk usage:', error);
      return null;
    })
    .then(value => {
      diskReading = { key, at: Date.now(), value };
      if (diskInFlight && diskInFlight.key === key) diskInFlight = null;
      return value;
    });

  diskInFlight = { key, promise };
  return promise;
}

/** Drop the cached reading and any resolved capacities so the next call re-reads from scratch. */
export function clearDiskUsageCache(): void {
  diskReading = null;
  diskInFlight = null;
  driveCapacityCache.clear();
}

async function readDiskUsage(targetPath: string): Promise<DiskUsage | null> {
  if (getPlatform() !== 'windows') return readDiskUsageLinux(targetPath);

  const resolved = path.resolve(targetPath || os.homedir());
  const drive = resolved.slice(0, 2); // e.g. "C:"
  if (!/^[A-Za-z]:$/.test(drive)) return null;

  // Steady state: capacity is already known, so a refresh is one `dir` call (~10ms) instead of
  // anything that has to report both numbers.
  const cachedTotal = driveCapacityCache.get(drive);
  if (cachedTotal !== undefined) {
    const free = await readFreeBytesViaDir(drive);
    if (free !== null) return { total: cachedTotal, free };
  }

  // First read of this drive: the script host returns both numbers in one ~40ms call, and its
  // output is raw integers, so it is unaffected by the display language.
  const viaScriptHost = await readVolumeViaScriptHost(drive);
  if (viaScriptHost) {
    driveCapacityCache.set(drive, viaScriptHost.total);
    return viaScriptHost;
  }

  // Script host unavailable (disabled by policy). Derive capacity from free bytes and the
  // free-space percentage, both from native binaries. Last resort because the typeperf counter
  // name is translated on non-English Windows and so will simply not resolve there.
  const free = await readFreeBytesViaDir(drive);
  if (free === null) return null;
  const percentFree = await readFreePercentViaTypeperf(drive);
  if (percentFree === null || percentFree < 0.01) return null;
  const total = Math.round(free / (percentFree / 100));
  if (!Number.isFinite(total) || total <= 0) return null;
  driveCapacityCache.set(drive, total);
  return { total, free };
}

/** Linux: POSIX df output in 1K blocks. */
async function readDiskUsageLinux(targetPath: string): Promise<DiskUsage | null> {
  const output = await execFileAsync('df', ['-kP', targetPath || os.homedir()], { encoding: 'utf8', timeout: 5000 });
  const lines = output.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const cols = lines[lines.length - 1].trim().split(/\s+/);
  // Filesystem 1K-blocks Used Available Use% Mounted
  const totalKb = Number(cols[1]);
  const availKb = Number(cols[3]);
  if (!Number.isFinite(totalKb) || !Number.isFinite(availKb) || totalKb <= 0) return null;
  return { total: totalKb * 1024, free: availKb * 1024 };
}

/**
 * Free bytes from `dir /-c`.
 *
 * `/-c` drops the thousands separators, and taking the last integer on the last non-empty line
 * keeps this working on localised Windows, where the trailing "bytes free" text is translated
 * but the layout is not. `/d` skips any AutoRun command that would pollute stdout.
 */
async function readFreeBytesViaDir(drive: string): Promise<number | null> {
  try {
    // Passed as separate argv entries, and targeting `C:\.` rather than `C:\`: a trailing
    // backslash escapes the closing quote Windows adds when building the command line, which
    // makes cmd reject the path outright. The `.` keeps it a directory without that hazard.
    return parseDirFreeBytes(await execFileAsync('cmd', ['/d', '/c', 'dir', '/-c', `${drive}\\.`]));
  } catch (error) {
    console.debug('[platform-utils] `dir` free-space read failed:', error);
    return null;
  }
}

/** Pull the free-byte count out of `dir /-c` output. See readFreeBytesViaDir for why. */
export function parseDirFreeBytes(output: string): number | null {
  const lines = output.trim().split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return null;
  const numbers = lines[lines.length - 1].match(/\d+/g);
  if (!numbers || !numbers.length) return null;
  const free = Number(numbers[numbers.length - 1]);
  return Number.isFinite(free) ? free : null;
}

/** Resolved once; undefined means "not looked up yet", null means "not present". */
let diskInfoScriptPath: string | null | undefined;

function resolveDiskInfoScript(): string | null {
  if (diskInfoScriptPath !== undefined) return diskInfoScriptPath;
  const candidates: string[] = [];
  // Packaged: copied in by electron-builder's win.extraResources.
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'scripts', 'diskinfo.js'));
  // Development: run straight out of the repo (this file compiles to electron/utils).
  candidates.push(path.join(__dirname, '..', '..', 'resources', 'diskinfo.js'));

  diskInfoScriptPath = candidates.find(candidate => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || null;
  if (!diskInfoScriptPath) console.debug('[platform-utils] diskinfo.js not found; falling back to dir + typeperf');
  return diskInfoScriptPath;
}

/** Total and free bytes via Scripting.FileSystemObject, run by the built-in Windows script host. */
async function readVolumeViaScriptHost(drive: string): Promise<DiskUsage | null> {
  const script = resolveDiskInfoScript();
  if (!script) return null;
  try {
    const output = await execFileAsync('cscript', ['//nologo', '//E:jscript', script, drive]);
    const [totalStr, freeStr] = output.trim().split(/\r?\n/);
    const total = Number(totalStr);
    const free = Number(freeStr);
    if (!Number.isFinite(total) || !Number.isFinite(free) || total <= 0) return null;
    return { total, free };
  } catch (error) {
    console.debug('[platform-utils] Script host volume read failed:', error);
    return null;
  }
}

/** Free-space percentage from the performance counters. English-locale Windows only. */
async function readFreePercentViaTypeperf(drive: string): Promise<number | null> {
  try {
    // typeperf samples over an interval, so it needs a longer leash than the other commands.
    const output = await execFileAsync(
      'typeperf',
      [`\\LogicalDisk(${drive})\\% Free Space`, '-sc', '1'],
      { ...METRICS_EXEC_OPTIONS, timeout: 15000 }
    );
    for (const line of output.split(/\r?\n/)) {
      // Data rows are `"<timestamp>","<value>"`; the header's second field is the counter path.
      const match = line.match(/^"[^"]*","(-?[\d.,]+)"\s*$/);
      if (!match) continue;
      const value = Number(match[1].replace(',', '.'));
      if (Number.isFinite(value)) return value;
    }
    return null;
  } catch (error) {
    console.debug('[platform-utils] typeperf free-space read failed:', error);
    return null;
  }
}

/**
 * Cumulative CPU seconds consumed by a process. Sampling twice and dividing the delta by the
 * elapsed wall time and core count gives a percentage — see ServerMonitoringService.
 * Returns null when it cannot be determined (process gone, tooling missing).
 */
export async function getProcessCpuSeconds(pid: number): Promise<number | null> {
  const stats = await getProcessStats(pid);
  return stats ? stats.cpuSeconds : null;
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
