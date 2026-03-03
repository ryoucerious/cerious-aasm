/**
 * Application Logger
 *
 * Wraps electron-log to provide:
 *   - Timestamped, levelled log lines in the console
 *   - Persistent log file in {userData}/logs/cerious-aasm.log  (10 MB, then rotates)
 *   - Global console.* override so every existing call site is automatically captured
 *
 * Import this module ONCE, as early as possible in main.ts, before any other imports.
 */

import log from 'electron-log/main';
import { app } from 'electron';
import * as path from 'path';

// ── File transport ──────────────────────────────────────────────────────────────
log.transports.file.level = 'debug';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB → rotate
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}';

// Resolved lazily so app.getPath() is available (called on first write, after app ready)
log.transports.file.resolvePathFn = () =>
  path.join(app.getPath('userData'), 'logs', 'cerious-aasm.log');

// ── Console transport ───────────────────────────────────────────────────────────
log.transports.console.level = process.env['NODE_ENV'] === 'development' ? 'debug' : 'info';
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}]{scope} {text}';

// ── IPC bridge (enables renderer / web-server process logs to route here) ──────
log.initialize();

// ── Override global console.* ───────────────────────────────────────────────────
// All existing console.log / .warn / .error calls throughout the codebase
// automatically route through electron-log and are written to the log file.
console.log   = log.log.bind(log);
console.info  = log.info.bind(log);
console.warn  = log.warn.bind(log);
console.error = log.error.bind(log);
console.debug = log.debug.bind(log);

/** Absolute path to the active log file (available after app ready). */
export function getLogFilePath(): string {
  return log.transports.file.getFile().path;
}

export default log;
