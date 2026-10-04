import * as fs from 'fs';
import * as path from 'path';
import { getArkServerDir } from '../utils/ark/ark-server/ark-server-paths.utils';

export class LogService {
  /** Empties the shared install's ShooterGame logs; the files themselves are kept. */
  static clearArkLogFiles(): void {
    try {
      const logsDir = path.join(getArkServerDir(), 'ShooterGame', 'Saved', 'Logs');
      if (fs.existsSync(logsDir)) {
        const logFiles = fs.readdirSync(logsDir).filter(f => /^ShooterGame(_\d+)?\.log$/.test(f));
        for (const logFile of logFiles) {
          fs.writeFileSync(path.join(logsDir, logFile), '', 'utf8');
        }
      }
    } catch (e) {
      console.error('[log-service] Failed to clear ARK log files:', e);
    }
  }
}