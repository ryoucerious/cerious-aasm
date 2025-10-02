// ark-server-logging.utils.ts
// Utility functions for ARK server logging and log tailing

import * as path from 'path';
import * as fs from 'fs';
import { getArkServerDir } from './ark-server-install.utils';
import { getDefaultInstancesBaseDir, getInstancesBaseDir } from '../../ark/instance.utils';
import { getInstanceState, setInstanceState } from './ark-server-state.utils';

/**
 * Returns the last N lines of the log file for a given instance.
 */
export function getInstanceLogs(instanceId: string, maxLines = 200): string[] {
  const state = getInstanceState(instanceId)?.toLowerCase();
  if (state !== 'running' && state !== 'starting' && state !== 'stopping') return [];
  const baseDir = getDefaultInstancesBaseDir?.() || getInstancesBaseDir?.();
  if (!baseDir) return [];
  const instanceDir = path.join(baseDir, instanceId);
  const logsDir = path.join(getArkServerDir(), 'ShooterGame', 'Saved', 'Logs');
  if (!fs.existsSync(logsDir)) return [];
  let config: any = {};
  try {
    const configPath = path.join(instanceDir, 'config.json');
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch {}
  const sessionName = config.sessionName || 'My Server';
  let foundLogFile: string | null = null;
  const logFiles = fs.readdirSync(logsDir)
    .filter(f => /^ShooterGame(\_\d+)?\.log$/.test(f) && !f.includes('BACKUP'))
    .map(f => ({
      file: f,
      path: path.join(logsDir, f),
      mtime: fs.statSync(path.join(logsDir, f)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime); // Most recent first

  // Try to find log file with our session name
  for (const logInfo of logFiles) {
    try {
      const content = fs.readFileSync(logInfo.path, 'utf8');
      if (content.includes(`SessionName=${sessionName}`) ||
          content.includes(sessionName)) {
        foundLogFile = logInfo.path;
        break;
      }
    } catch {}
  }

  // If no session-specific log found, use the most recent log file
  if (!foundLogFile && logFiles.length > 0) {
    foundLogFile = logFiles[0].path;
  }
  if (!foundLogFile) return [];
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
 * Sets up log tailing for the server process
 */
export function setupLogTailing(instanceId: string, instanceDir: string, config: any, onLog?: (data: string) => void, onState?: (state: string) => void): any {
  let logTail: any = null;
  let hasAdvertised = false;

  setTimeout(() => {
    // Find the most recent log file (ARK creates new log files for each server start)
    const logsDir = path.join(getArkServerDir(), 'ShooterGame', 'Saved', 'Logs');
    let sessionName = config.sessionName || 'My Server';
    let foundLogFile: string | null = null;

    if (fs.existsSync(logsDir)) {
      const logFiles = fs.readdirSync(logsDir)
        .filter(f => /^ShooterGame(\_\d+)?\.log$/.test(f) && !f.includes('BACKUP'))
        .map(f => ({
          file: f,
          path: path.join(logsDir, f),
          mtime: fs.statSync(path.join(logsDir, f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime); // Most recent first

      // Try to find log file with our session name, otherwise use the most recent
      for (const logInfo of logFiles) {
        try {
          const content = fs.readFileSync(logInfo.path, 'utf8');
          if (content.includes(sessionName) || content.includes(`SessionName=${sessionName}`)) {
            foundLogFile = logInfo.path;
            break;
          }
        } catch {}
      }

      // If no session-specific log found, use the most recent log file
      if (!foundLogFile && logFiles.length > 0) {
        foundLogFile = logFiles[0].path;
        if (onLog) onLog(`[INFO] Using most recent log file: ${logFiles[0].file}`);
      }
    }

    // Wrap the onLog callback to detect the advertising message
    const wrappedOnLog = (line: string) => {
      // Look for the exact server ready indicator
      if (!hasAdvertised && line.includes('Server has completed startup and is now advertising for join.')) {
        hasAdvertised = true;
        setInstanceState(instanceId, 'running');
        if (onState) onState('running');
      }
      // Detect stop request
      if (line.includes('Closing by request')) {
        setInstanceState(instanceId, 'stopping');
        if (onState) onState('stopping');
      }
      if (onLog) onLog(line);
    };

    if (foundLogFile) {
      logTail = startArkLogTailing(instanceDir, wrappedOnLog, foundLogFile);
    } else {
      // Fallback: tail the default log file
      logTail = startArkLogTailing(instanceDir, wrappedOnLog);
    }
  }, 1000); // Wait for the log file to appear and be written

  return logTail;
}