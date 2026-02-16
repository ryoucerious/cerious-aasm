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
 * Snapshot the current set of log file paths.
 * Call this BEFORE starting a server process.
 */
export function snapshotLogFiles(): Set<string> {
  const logsDir = getLogsDir();
  const files = listLogFiles(logsDir);
  return new Set(files.map(f => f.path));
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
  preStartSnapshot: Set<string>,
  maxAttempts = 30
): void {
  const logsDir = getLogsDir();
  let attempts = 0;

  function tryDetect() {
    attempts++;
    const currentFiles = listLogFiles(logsDir);

    // Strategy 1: Find a NEW file that wasn't in the pre-start snapshot
    const newFiles = currentFiles.filter(f => !preStartSnapshot.has(f.path));
    if (newFiles.length === 1) {
      // Exactly one new file — this is our server's log
      instanceLogFileMap[instanceId] = newFiles[0].path;
      console.log(`[ark-logging] Registered log file for ${instanceId}: ${newFiles[0].file} (new file)`);
      return;
    }

    // Strategy 2: If multiple new files or none, search by session name
    for (const logInfo of currentFiles) {
      try {
        const content = fs.readFileSync(logInfo.path, 'utf8');
        if (content.includes(`SessionName=${sessionName}`) || content.includes(sessionName)) {
          // Make sure this file isn't already claimed by another instance
          const claimedBy = Object.entries(instanceLogFileMap).find(([id, p]) => p === logInfo.path && id !== instanceId);
          if (!claimedBy) {
            instanceLogFileMap[instanceId] = logInfo.path;
            console.log(`[ark-logging] Registered log file for ${instanceId}: ${logInfo.file} (session name match)`);
            return;
          }
        }
      } catch {}
    }

    // Strategy 3: If multiple new files, pick the one not claimed by another instance
    if (newFiles.length > 1) {
      const claimedPaths = new Set(Object.values(instanceLogFileMap));
      const unclaimed = newFiles.filter(f => !claimedPaths.has(f.path));
      if (unclaimed.length > 0) {
        instanceLogFileMap[instanceId] = unclaimed[0].path;
        console.log(`[ark-logging] Registered log file for ${instanceId}: ${unclaimed[0].file} (unclaimed new file)`);
        return;
      }
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
  const content = fs.readFileSync(foundLogFile, 'utf8');
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  return lines.slice(-maxLines);
}

/**
 * Watches the Ark server log file for new lines and streams them to the callback.
 * Returns a watcher object with a close() method.
 */
export function startArkLogTailing(instanceDir: string, onLog?: (data: string) => void, forceLogFile?: string | null) {
  // Correct log directory: <arkInstall>/ShooterGame/Saved/Logs
  const logsDir = path.join(getArkServerDir(), 'ShooterGame', 'Saved', 'Logs');
  let logFile: string | null = null;
  let logFileWatcher: fs.FSWatcher | null = null;
  let logFilePosition = 0;
  let attempts = 0;
  const maxAttempts = 60; // Wait up to 60 seconds

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

  function tryAttachWatcher() {
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
      const stats = fs.statSync(logFile);
      logFilePosition = stats.size;
      // Deduplication buffer: last 200 lines sent
      let lastSentLines: string[] = [];
      logFileWatcher = fs.watch(logFile, (eventType) => {
        if (eventType === 'change') {
          if (logFile) {
            const content = fs.readFileSync(logFile, 'utf8');
            const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
            // Find the first line that is new compared to lastSentLines
            let startIdx = 0;
            while (
              startIdx < lines.length &&
              lastSentLines.length > 0 &&
              lines[startIdx] === lastSentLines[startIdx]
            ) {
              startIdx++;
            }
            const newLines = lines.slice(startIdx);
            if (newLines.length > 0) {
              for (const line of newLines) {
                onLog(line);
              }
              // Update deduplication buffer
              lastSentLines = lines.slice(-200);
            }
          }
        }
      });
    }
  }
  tryAttachWatcher();
  return {
    close: () => { if (logFileWatcher) logFileWatcher.close(); }
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

  // Wrap the onLog callback to detect state transitions
  const wrappedOnLog = (line: string) => {
    if (!hasAdvertised && line.includes('Server has completed startup and is now advertising for join.')) {
      hasAdvertised = true;
      setInstanceState(instanceId, 'running');
      if (onState) onState('running');
    }
    if (line.includes('Closing by request')) {
      setInstanceState(instanceId, 'stopping');
      if (onState) onState('stopping');
    }
    if (onLog) onLog(line);
  };

  let attempts = 0;
  const maxAttempts = 60; // Retry for up to 60 seconds

  function trySetupTailing() {
    attempts++;
    const logsDir = getLogsDir();
    const sessionName = config.sessionName || '';

    // Priority 1: Use registered log file
    let foundLogFile: string | null = getRegisteredLogFile(instanceId);

    // Priority 2: Search by session name (avoid files claimed by other instances)
    if (!foundLogFile && sessionName && fs.existsSync(logsDir)) {
      const logFiles = listLogFiles(logsDir);
      const claimedPaths = new Set(Object.values(instanceLogFileMap));

      for (const logInfo of logFiles) {
        try {
          const content = fs.readFileSync(logInfo.path, 'utf8');
          if (content.includes(sessionName) || content.includes(`SessionName=${sessionName}`)) {
            // Only claim if not already registered to another instance
            if (!claimedPaths.has(logInfo.path)) {
              foundLogFile = logInfo.path;
              instanceLogFileMap[instanceId] = logInfo.path;
              console.log(`[ark-logging] setupLogTailing registered ${logInfo.file} for ${instanceId}`);
              break;
            }
            const claimer = Object.entries(instanceLogFileMap).find(([, p]) => p === logInfo.path);
            if (claimer && claimer[0] === instanceId) {
              foundLogFile = logInfo.path;
              break;
            }
          }
        } catch {}
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