// --- Imports ---
import * as path from 'path';
import * as fs from 'fs';
import { ArkPathUtils } from './ark-path.utils';

// --- Log Parsing Helpers ---
export class ArkLogUtils {
  /**
   * Parse ARK server logs for useful information
   */
  static parseServerLogs(logContent: string): {
    serverStarted: boolean;
    errors: string[];
    warnings: string[];
    playerJoins: string[];
    playerLeaves: string[];
  } {
    const lines = logContent.split('\n');
    const result = {
      serverStarted: false,
      errors: [] as string[],
      warnings: [] as string[],
      playerJoins: [] as string[],
      playerLeaves: [] as string[]
    };

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Check for server startup
      if (trimmedLine.includes('Server ready') || trimmedLine.includes('Listening on port')) {
        result.serverStarted = true;
      }

      // Check for errors
      if (trimmedLine.toLowerCase().includes('error')) {
        result.errors.push(trimmedLine);
      }

      // Check for warnings
      if (trimmedLine.toLowerCase().includes('warning')) {
        result.warnings.push(trimmedLine);
      }

      // Check for player events
      if (trimmedLine.includes('joined the game')) {
        result.playerJoins.push(trimmedLine);
      }

      if (trimmedLine.includes('left the game')) {
        result.playerLeaves.push(trimmedLine);
      }
    }

    return result;
  }

  /**
   * Get the latest log file for a server session
   */
  static getLatestLogFile(sessionName: string): string | null {
    const logsDir = ArkPathUtils.getArkLogsDir();
    if (!fs.existsSync(logsDir)) {
      return null;
    }

    try {
      // ARK log files are named ShooterGame.log or ShooterGame_X.log, not by session name
      const logFiles = fs.readdirSync(logsDir)
        .filter(file => /^ShooterGame(\_\d+)?\.log$/.test(file) && !file.includes('BACKUP') && !file.includes('backup'))
        .map(file => ({
          name: file,
          path: path.join(logsDir, file),
          stats: fs.statSync(path.join(logsDir, file))
        }))
        .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

      // Try to find a log file that contains our session name
      for (const logFile of logFiles) {
        try {
          const content = fs.readFileSync(logFile.path, 'utf8');
          if (content.includes(`SessionName=${sessionName}`) || content.includes(sessionName)) {
            return logFile.path;
          }
        } catch (error) {
          // Continue to next file if this one can't be read
          continue;
        }
      }

      // If no session-specific log found, return the most recent ShooterGame log
      return logFiles.length > 0 ? logFiles[0].path : null;
    } catch (error) {
      console.error('[ark-utils] Failed to get latest log file:', error);
      return null;
    }
  }
}