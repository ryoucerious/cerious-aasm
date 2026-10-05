/**
 * Routes console.* through electron-log: levelled console lines plus {userData}/logs/cerious-aasm.log
 * (rotated at 10 MB). Import it first in main.ts so every later module's logging is captured.
 */

import log from 'electron-log';
import { app } from 'electron';
import * as os from 'os';
import * as path from 'path';

// Electron's own default: <appData>/<package.json name>. Used when app.getPath is unavailable.
function defaultUserDataDir(): string {
  const home = os.homedir();
  let appData: string;
  if (process.platform === 'win32') {
    appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  } else if (process.platform === 'darwin') {
    appData = path.join(home, 'Library', 'Application Support');
  } else {
    appData = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  }
  return path.join(appData, 'cerious-aasm');
}

log.transports.file.level = 'debug';
log.transports.file.maxSize = 10 * 1024 * 1024;
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}';

// Resolved on the first write rather than now, so app.getPath is normally available.
log.transports.file.resolvePathFn = () => {
  let userData: string;
  try {
    userData = app.getPath('userData');
  } catch {
    userData = defaultUserDataDir();
  }
  return path.join(userData, 'logs', 'cerious-aasm.log');
};

log.transports.console.level = process.env['NODE_ENV'] === 'development' ? 'debug' : 'info';
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}]{scope} {text}';

// Lets renderer processes log through this file as well.
log.initialize();

console.log = log.log.bind(log);
console.info = log.info.bind(log);
console.warn = log.warn.bind(log);
console.error = log.error.bind(log);
console.debug = log.debug.bind(log);

/** Absolute path to the active log file, once the app is ready. */
export function getLogFilePath(): string {
  return log.transports.file.getFile().path;
}

export default log;
