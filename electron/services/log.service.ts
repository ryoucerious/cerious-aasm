import * as fs from 'fs';
import * as path from 'path';
import { ArkPathUtils } from '../utils/ark.utils';

/**
 * Utility service for managing ARK server log files
 */
export class LogService {
  /**
   * Clear all ARK server log files
   */
  static clearArkLogFiles(): void {
    try {
      const logsDir = path.join(ArkPathUtils.getArkServerDir(), 'ShooterGame', 'Saved', 'Logs');
      if (fs.existsSync(logsDir)) {
        const logFiles = fs.readdirSync(logsDir).filter(f => /^ShooterGame(\_\d+)?\.log$/.test(f));
        for (const logFile of logFiles) {
          const logPath = path.join(logsDir, logFile);
          fs.writeFileSync(logPath, '', 'utf8');
        }
      }
    } catch (e) {
      console.error('[LogService] Failed to clear ARK log files:', e);
    }
  }
}