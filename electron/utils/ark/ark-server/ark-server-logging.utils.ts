// ark-server-logging.utils.ts
// Utility functions for ARK server logging and log tailing

import * as path from 'path';
import * as fs from 'fs';
import { getArkServerDir } from './ark-server-install.utils';
import { getDefaultInstancesBaseDir, getInstancesBaseDir } from '../../ark/instance.utils';
import { getInstanceState, setInstanceState } from './ark-server-state.utils';

// ---- Per-instance log file registry ----
// Tracks which log file belongs to which server instance to prevent cross-contamination
// when multiple servers run from the same ARK installation (shared Logs directory).
const instanceLogFileMap: Record<string, string> = {};

// ---- Per-instance pre-start snapshots ----
// Stores path→mtime at the moment just before server start so we can detect
// which log file (new OR overwritten) belongs to this instance.
const instanceSnapshotMap: Record<string, Map<string, number>> = {};

/**
 * Get the shared ARK server Logs directory path.
 */
function getLogsDir(): string {
  return path.join(getArkServerDir(), 'ShooterGame', 'Saved', 'Logs');
}

/**
 * List all ShooterGame*.log files (excluding BACKUP), sorted most-recent first.
 */
function listLogFiles(logsDir: string): { file: string; path: string; mtime: number }[] {
  if (!fs.existsSync(logsDir)) return [];
  return fs.readdirSync(logsDir)
    .filter(f => /^ShooterGame(\_\d+)?\.log$/.test(f) && !f.includes('BACKUP'))
    .map(f => ({
      file: f,
      path: path.join(logsDir, f),
      mtime: fs.statSync(path.join(logsDir, f)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * Snapshot the current log files (path → mtime) BEFORE starting a server process.
 * Capturing mtime lets us detect files that are overwritten rather than newly created.
 */
export function snapshotLogFiles(): Map<string, number> {
  const logsDir = getLogsDir();
  const files = listLogFiles(logsDir);
  const snapshot = new Map<string, number>();
  for (const f of files) snapshot.set(f.path, f.mtime);
  return snapshot;
}

/**
 * After a server starts, detect which NEW log file appeared (or which existing file
 * now contains the session name). Register it for the given instanceId.
 * 
 * @param instanceId - The server instance ID
 * @param sessionName - The server's session name to match in log content
 * @param preStartSnapshot - The set of log file paths from before server start
 * @param maxAttempts - Max retries (1 second apart) to find the log file
 */
export function detectAndRegisterLogFile(
  instanceId: string,
  sessionName: string,
  preStartSnapshot: Map<string, number>,
  maxAttempts = 30
): void {
  // Store snapshot so setupLogTailing can use the same detection strategy
  instanceSnapshotMap[instanceId] = preStartSnapshot;

  const logsDir = getLogsDir();
  let attempts = 0;

  function tryDetect() {
    attempts++;
    const currentFiles = listLogFiles(logsDir);
    const claimedPaths = new Set(
      Object.entries(instanceLogFileMap)
        .filter(([id]) => id !== instanceId)
        .map(([, p]) => p)
    );

    // Strategy 1: find a file that is either brand-new OR was overwritten since the
    // snapshot (same path but mtime is newer). On Windows ARK usually creates a new
    // numbered file; on Linux/Proton it typically overwrites ShooterGame.log in place.
    const changedFiles = currentFiles.filter(f => {
      const snapshotMtime = preStartSnapshot.get(f.path);
      return snapshotMtime === undefined   // brand-new path
          || f.mtime > snapshotMtime;      // overwritten in place
    }).filter(f => !claimedPaths.has(f.path));

    if (changedFiles.length === 1) {
      instanceLogFileMap[instanceId] = changedFiles[0].path;
      console.log(`[ark-logging] Registered log file for ${instanceId}: ${changedFiles[0].file}`);
      return;
    }

    if (changedFiles.length > 1) {
      // Multiple candidates — prefer the most recently modified one
      const best = changedFiles[0]; // already sorted newest-first by listLogFiles
      instanceLogFileMap[instanceId] = best.path;
      console.log(`[ark-logging] Registered log file for ${instanceId}: ${best.file} (most recent of ${changedFiles.length} candidates)`);
      return;
    }

    // Retry if we haven't found it yet
    if (attempts < maxAttempts) {
      setTimeout(tryDetect, 1000);
    } else {
      console.warn(`[ark-logging] Could not detect log file for ${instanceId} after ${maxAttempts} attempts`);
    }
  }

  // Start detection after a small delay to let the process create its log file
  setTimeout(tryDetect, 2000);
}

/**
 * Get the registered log file path for an instance, or null if not tracked.
 */
export function getRegisteredLogFile(instanceId: string): string | null {
  return instanceLogFileMap[instanceId] || null;
}

/**
 * Unregister a log file when a server stops.
 */
export function unregisterLogFile(instanceId: string): void {
  delete instanceLogFileMap[instanceId];
  delete instanceSnapshotMap[instanceId];
}

/**
 * Returns the last N lines of the log file for a given instance.
 * Uses the registered log file if available to avoid cross-contamination.
 */
export function getInstanceLogs(instanceId: string, maxLines = 200): string[] {
  const state = getInstanceState(instanceId)?.toLowerCase();
  if (state !== 'running' && state !== 'starting' && state !== 'stopping') return [];
  const logsDir = getLogsDir();
  if (!fs.existsSync(logsDir)) return [];

  // Priority 1: Use the registered log file for this instance
  let foundLogFile: string | null = getRegisteredLogFile(instanceId);

  // Priority 2: Search by session name (only if not registered)
  if (!foundLogFile) {
    let config: any = {};
    try {
      const baseDir = getDefaultInstancesBaseDir?.() || getInstancesBaseDir?.();
      if (baseDir) {
        const configPath = path.join(baseDir, instanceId, 'config.json');
        if (fs.existsSync(configPath)) {
          config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
      }
    } catch {}
    const sessionName = config.sessionName || '';
    if (sessionName) {
      const logFiles = listLogFiles(logsDir);
      const claimedPaths = new Set(Object.values(instanceLogFileMap));
      for (const logInfo of logFiles) {
        try {
          const content = fs.readFileSync(logInfo.path, 'utf8');
          if (content.includes(`SessionName=${sessionName}`) || content.includes(sessionName)) {
            // Only use if not claimed by a different instance
            if (!claimedPaths.has(logInfo.path)) {
              foundLogFile = logInfo.path;
              // Register it now for future calls
              instanceLogFileMap[instanceId] = logInfo.path;
              break;
            }
            // Also accept if it IS claimed by this same instance
            const claimer = Object.entries(instanceLogFileMap).find(([, p]) => p === logInfo.path);
            if (claimer && claimer[0] === instanceId) {
              foundLogFile = logInfo.path;
              break;
            }
          }
        } catch {}
      }
    }
  }

  // Do NOT fall back to "most recent file" — that causes cross-contamination
  if (!foundLogFile) return [];

  if (!fs.existsSync(foundLogFile)) return [];
  // Read only the last 64 KB instead of the entire file.
  // ARK log files can grow to several GB; loading the full file into the Node.js heap
  // on every call causes the Electron process to balloon to 10+ GB RSS on Linux.
  // Per-instance isolation is unchanged — which file to read is decided above.
  const TAIL_BYTES = 64 * 1024;
  const fileStat = fs.statSync(foundLogFile);
  const offset = Math.max(0, fileStat.size - TAIL_BYTES);
  const fd = fs.openSync(foundLogFile, 'r');
  const buf = Buffer.alloc(Math.min(TAIL_BYTES, fileStat.size));
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').split(/\r?\n/).filter(line => line.trim().length > 0);
  return lines.slice(-maxLines);
}

/**
 * Watches the Ark server log file for new lines and streams them to the callback.
 * Uses position-based reading and a polling fallback alongside fs.watch for reliability.
 * Returns a watcher object with a close() method.
 */
export function startArkLogTailing(instanceDir: string, onLog?: (data: string) => void, forceLogFile?: string | null) {
  // Correct log directory: <arkInstall>/ShooterGame/Saved/Logs
  const logsDir = path.join(getArkServerDir(), 'ShooterGame', 'Saved', 'Logs');
  let logFile: string | null = null;
  let logFileWatcher: fs.FSWatcher | null = null;
  let logFilePosition = 0;
  let pollInterval: NodeJS.Timeout | null = null;
  let attempts = 0;
  const maxAttempts = 60;
  let closed = false;

  function findLogFileForSession(): string | null {
    if (forceLogFile && fs.existsSync(forceLogFile)) return forceLogFile;
    if (!fs.existsSync(logsDir)) return null;
    // Only match ShooterGame.log and ShooterGame_<number>.log, and exclude any with 'BACKUP' in the name
    const logFiles = fs.readdirSync(logsDir)
      .filter(f => /^ShooterGame(\_\d+)?\.log$/.test(f) && !f.includes('BACKUP'))
      .map(f => ({
        file: f,
        mtime: fs.statSync(path.join(logsDir, f)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime);
    if (logFiles.length > 0) {
      return path.join(logsDir, logFiles[0].file);
    }
    return null;
  }

  /**
   * Read new content from the log file starting from the last known position.
   * Uses byte-level position tracking to avoid deduplication issues.
   */
  function readNewContent() {
    if (!logFile || !onLog || closed) return;
    try {
      if (!fs.existsSync(logFile)) return;
      const stats = fs.statSync(logFile);
      const currentSize = stats.size;

      // If file was truncated/rotated, reset position
      if (currentSize < logFilePosition) {
        logFilePosition = 0;
      }

      // If no new content, skip
      if (currentSize <= logFilePosition) return;

      // Read only the new bytes
      const fd = fs.openSync(logFile, 'r');
      const buffer = Buffer.alloc(currentSize - logFilePosition);
      fs.readSync(fd, buffer, 0, buffer.length, logFilePosition);
      fs.closeSync(fd);

      logFilePosition = currentSize;

      // Parse and emit new lines
      const newContent = buffer.toString('utf8');
      const lines = newContent.split(/\r?\n/).filter(line => line.trim().length > 0);
      for (const line of lines) {
        onLog(line);
      }
    } catch (error) {
      // Silently handle read errors (file may be locked momentarily)
      console.debug('[ark-logging] Error reading log file:', error);
    }
  }

  function tryAttachWatcher() {
    if (closed) return;
    attempts++;
    if (!fs.existsSync(logsDir)) {
      if (attempts < maxAttempts) setTimeout(tryAttachWatcher, 1000);
      return;
    }
    logFile = findLogFileForSession();
    if (!logFile) {
      if (attempts < maxAttempts) setTimeout(tryAttachWatcher, 1000);
      return;
    }
    if (onLog) {
      // Start reading from current end of file (only tail new content)
      const stats = fs.statSync(logFile);
      logFilePosition = stats.size;

      // Use fs.watch for immediate notification (when it works)
      try {
        logFileWatcher = fs.watch(logFile, (eventType) => {
          if (eventType === 'change') {
            readNewContent();
          }
        });
        logFileWatcher.on('error', () => {
          // fs.watch failed — polling will still work as fallback
          console.debug('[ark-logging] fs.watch error, relying on polling fallback');
        });
      } catch {
        console.debug('[ark-logging] fs.watch unavailable, relying on polling fallback');
      }

      // Polling fallback: check for new content every 3 seconds
      // This ensures we catch changes even if fs.watch is unreliable
      pollInterval = setInterval(readNewContent, 3000);
    }
  }
  tryAttachWatcher();
  return {
    close: () => {
      closed = true;
      if (logFileWatcher) logFileWatcher.close();
      if (pollInterval) clearInterval(pollInterval);
    }
  };
}

/**
 * Cleans up old log files for the current session
 */
export function cleanupOldLogFiles(config: any, onLog?: (data: string) => void): void {
  try {
    const logsDir = path.join(getArkServerDir(), 'ShooterGame', 'Saved', 'Logs');
    if (!fs.existsSync(logsDir)) return;

    const sessionName = config.sessionName || 'My Server';
    const logFiles = fs.readdirSync(logsDir)
      .filter(f => /^ShooterGame(\_\d+)?\.log$/.test(f) && !f.includes('BACKUP'));

    for (const file of logFiles) {
      const filePath = path.join(logsDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        // Only delete if it contains our specific session name
        if (content.includes(`SessionName=${sessionName}`) ||
            (content.includes(sessionName) && content.includes('Server has completed startup'))) {
          fs.unlinkSync(filePath);
          if (onLog) onLog(`[INFO] Cleaned up old log file: ${file}`);
        }
      } catch {}
    }
  } catch (e) {
    console.error('[ark-server-utils] Failed to clean up log files:', e);
  }
}

/**
 * Sets up log tailing for the server process.
 * Uses the registered log file if available; otherwise searches by session name
 * with retry logic. Does NOT fall back to "most recent file" to prevent
 * cross-contamination between cluster servers.
 */
export function setupLogTailing(instanceId: string, instanceDir: string, config: any, onLog?: (data: string) => void, onState?: (state: string) => void): any {
  let logTail: any = null;
  let hasAdvertised = false;

  // Startup detection strings — only lines that indicate the server is truly ready
  // for player connections AND has bound its RCON port.
  // NOTE: 'Full Startup:', 'Listening on port', 'StartPlay RPC completed', and
  // 'Initializing Game Engine Completed' all fire 30-60s BEFORE RCON is ready;
  // triggering RCON on those lines wastes the entire retry window on a port that
  // isn't open yet.  Use only the definitive advertising-for-join messages.
  const startupIndicators = [
    'Server has completed startup and is now advertising for join.',
    'Server is now advertising for join',
    'has completed startup and is now advertising'
  ];

  // Wrap the onLog callback to detect state transitions
  const wrappedOnLog = (line: string) => {
    if (!hasAdvertised) {
      const isStartupLine = startupIndicators.some(indicator => line.includes(indicator));
      if (isStartupLine) {
        hasAdvertised = true;
        setInstanceState(instanceId, 'running');
        if (onState) onState('running');
      }
    }
    if (line.includes('Closing by request') || line.includes('Server shutting down')) {
      setInstanceState(instanceId, 'stopping');
      if (onState) onState('stopping');
    }
    if (onLog) onLog(line);
  };

  let attempts = 0;
  const maxAttempts = 60;

  function trySetupTailing() {
    attempts++;
    const logsDir = getLogsDir();

    // Priority 1: Use the log file already registered by detectAndRegisterLogFile
    let foundLogFile: string | null = getRegisteredLogFile(instanceId);

    // Priority 2: Use the pre-start snapshot (same logic as detectAndRegisterLogFile)
    // This handles the case where setupLogTailing runs before detectAndRegisterLogFile
    // finishes, and also covers Linux/Proton which overwrites the existing log in-place.
    if (!foundLogFile && fs.existsSync(logsDir)) {
      const snapshot = instanceSnapshotMap[instanceId];
      if (snapshot) {
        const currentFiles = listLogFiles(logsDir);
        const claimedPaths = new Set(
          Object.entries(instanceLogFileMap)
            .filter(([id]) => id !== instanceId)
            .map(([, p]) => p)
        );
        const changedFiles = currentFiles.filter(f => {
          const snapshotMtime = snapshot.get(f.path);
          return (snapshotMtime === undefined || f.mtime > snapshotMtime)
              && !claimedPaths.has(f.path);
        });
        if (changedFiles.length >= 1) {
          foundLogFile = changedFiles[0].path;
          instanceLogFileMap[instanceId] = foundLogFile;
          console.log(`[ark-logging] setupLogTailing registered ${changedFiles[0].file} for ${instanceId} (snapshot delta)`);
        }
      }
    }

    if (foundLogFile) {
      if (onLog) onLog(`[INFO] Tailing log file: ${path.basename(foundLogFile)}`);
      logTail = startArkLogTailing(instanceDir, wrappedOnLog, foundLogFile);
    } else if (attempts < maxAttempts) {
      // Retry — the log file may not have been created or written to yet
      setTimeout(trySetupTailing, 1000);
    } else {
      console.warn(`[ark-logging] Could not find log file for ${instanceId} after ${maxAttempts}s — no tailing`);
      if (onLog) onLog(`[WARN] Could not detect log file for this server instance`);
    }
  }

  // Start after a brief delay to let the process create its log file
  setTimeout(trySetupTailing, 1000);
  return { close: () => { if (logTail) logTail.close(); } };
}