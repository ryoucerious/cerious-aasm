import * as fs from 'fs';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';
import { getArkServerDir, getInstanceLogsDir } from './ark-server-paths.utils';
import { getInstanceState, setInstanceState } from './ark-server-state.utils';

interface LogFileInfo {
  file: string;
  path: string;
  mtime: number;
}

interface Tailer {
  /** `drain` reads what the server wrote since the last poll before stopping. */
  close(drain: boolean): void;
}

const LOG_FILE_PATTERN = /^ShooterGame(_\d+)?\.log$/;
const DETECTION_DELAY_MS = 2000;
const RETRY_INTERVAL_MS = 1000;
const TAIL_ATTACH_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 3000;
// ARK logs grow to several GB; reading one whole on every request ballooned Electron past 10 GB.
const TAIL_BYTES = 64 * 1024;

// Only these lines mean the server takes players AND has bound its RCON port. 'Full Startup:',
// 'Listening on port', 'StartPlay RPC completed' and 'Initializing Game Engine Completed' come
// 30-60 s earlier, and connecting RCON on them wastes the retry window on a closed port.
const STARTUP_LINES = [
  'Server has completed startup and is now advertising for join.',
  'Server is now advertising for join',
  'has completed startup and is now advertising'
];
// The whole message of a line, after ARK's "[2026.09.11-22.33.00:824][837]" time and frame: chat is
// logged too, and a player typing the words must not turn a later crash into a stop.
const SHUTDOWN_LINE = /(^|\])(Closing by request|Server shutting down)\s*$/;

// Several servers can share one install's Logs directory, so each instance records which file
// is its own, and the log files as they were just before it started.
const registeredLogFiles: Record<string, string> = {};
const preStartSnapshots: Record<string, Map<string, number>> = {};
const detectionTimers: Record<string, NodeJS.Timeout> = {};
const tailers: Record<string, Tailer> = {};

/**
 * ARK writes Saved/Logs under the tree that owns the executable it launched: an instance with its
 * own binaries logs into its own folder, one on the shared executable into the shared install. Both
 * are scanned so detection keeps working if isolation is added or removed.
 */
function getLogsDirs(instanceId: string): string[] {
  const shared = path.join(getArkServerDir(), 'ShooterGame', 'Saved', 'Logs');
  let own: string | undefined;
  try {
    own = getInstanceLogsDir(instanceId);
  } catch {
    // Not resolvable before the server is installed
  }
  return own && own !== shared ? [own, shared] : [shared];
}

/** ShooterGame logs in `dirs`, newest first. */
function listLogFiles(dirs: string[]): LogFileInfo[] {
  const found: LogFileInfo[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!LOG_FILE_PATTERN.test(file)) continue;
      const filePath = path.join(dir, file);
      try {
        found.push({ file, path: filePath, mtime: fs.statSync(filePath).mtimeMs });
      } catch {
        // Vanished between readdir and stat
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

/** Log file path -> mtime, taken before a start so the instance's own file can be told apart. */
export function snapshotLogFiles(instanceId: string): Map<string, number> {
  return new Map(listLogFiles(getLogsDirs(instanceId)).map(file => [file.path, file.mtime]));
}

/**
 * Registers the newest log that appeared, or changed, since the instance's pre-start snapshot and
 * that no other instance has claimed. Windows ARK starts a new numbered file; Proton rewrites
 * ShooterGame.log in place, which only the mtime shows.
 */
function registerChangedLogFile(instanceId: string): string | null {
  const snapshot = preStartSnapshots[instanceId];
  if (!snapshot) return null;

  const claimed = new Set(
    Object.entries(registeredLogFiles).filter(([id]) => id !== instanceId).map(([, file]) => file)
  );
  const found = listLogFiles(getLogsDirs(instanceId)).find(file => {
    const before = snapshot.get(file.path);
    return (before === undefined || file.mtime > before) && !claimed.has(file.path);
  });
  if (!found) return null;

  registeredLogFiles[instanceId] = found.path;
  console.log(`[ark-logging] Registered log file for ${instanceId}: ${found.file}`);
  return found.path;
}

/** Looks for the log file a just-started server creates, retrying once a second. */
export function detectAndRegisterLogFile(instanceId: string, preStartSnapshot: Map<string, number>, maxAttempts = 30): void {
  clearTimeout(detectionTimers[instanceId]);
  preStartSnapshots[instanceId] = preStartSnapshot;
  let attempts = 0;

  const detect = () => {
    delete detectionTimers[instanceId];
    if (registeredLogFiles[instanceId] || registerChangedLogFile(instanceId)) return;
    if (++attempts < maxAttempts) {
      detectionTimers[instanceId] = setTimeout(detect, RETRY_INTERVAL_MS);
      return;
    }
    console.warn(`[ark-logging] Could not detect the log file for ${instanceId} after ${maxAttempts} attempts`);
  };
  detectionTimers[instanceId] = setTimeout(detect, DETECTION_DELAY_MS);
}

export function getRegisteredLogFile(instanceId: string): string | null {
  return registeredLogFiles[instanceId] || null;
}

/** For a server that stopped: cancels detection, and emits the log's last lines before closing it. */
export function unregisterLogFile(instanceId: string): void {
  clearTimeout(detectionTimers[instanceId]);
  delete detectionTimers[instanceId];
  closeTailer(instanceId, true);
  delete registeredLogFiles[instanceId];
  delete preStartSnapshots[instanceId];
}

/** The last `maxLines` lines of the instance's own log while it runs. */
export function getInstanceLogs(instanceId: string, maxLines = 200): string[] {
  const state = getInstanceState(instanceId);
  if (state !== 'running' && state !== 'starting' && state !== 'stopping') return [];

  // Never "the newest file": with several servers on one install that is often another server's.
  const file = registeredLogFiles[instanceId] || registerChangedLogFile(instanceId);
  return file ? readLogTail(file, maxLines) : [];
}

/** The last `maxLines` non-empty lines within the final 64 KB of a file; [] when it is unreadable. */
export function readLogTail(filePath: string, maxLines: number): string[] {
  let fd: number | undefined;
  try {
    const { size } = fs.statSync(filePath);
    const length = Math.min(TAIL_BYTES, size);
    const buffer = Buffer.alloc(length);
    fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/);
    // The read starts mid-line when the file is larger than the window.
    if (size > length) lines.shift();
    return lines.filter(line => line.trim().length > 0).slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeQuietly(fd);
  }
}

/**
 * Tails the instance's log once it is known, reporting 'running' on the advertising line and
 * 'stopping' on a shutdown line. Replaces any tailer the instance already has.
 */
export function setupLogTailing(instanceId: string, onLog?: (line: string) => void, onState?: (state: string) => void): void {
  closeTailer(instanceId, false);

  let closing = false;
  let advertised = false;
  let stopping = false;
  let tail: Tailer | null = null;
  let retryTimer: NodeJS.Timeout | undefined;
  let attempts = 0;

  const handleLine = (line: string) => {
    if (!advertised && STARTUP_LINES.some(marker => line.includes(marker))) {
      advertised = true;
      // Only a server still starting comes up: one already being stopped, or already gone (the
      // lines drained after an exit), must not be reported as running.
      if (!closing && getInstanceState(instanceId) === 'starting') {
        setInstanceState(instanceId, 'running');
        onState?.('running');
      }
    }
    if (!stopping && SHUTDOWN_LINE.test(line)) {
      stopping = true;
      setInstanceState(instanceId, 'stopping');
      onState?.('stopping');
    }
    onLog?.(line);
  };

  const attach = () => {
    retryTimer = undefined;
    const file = registeredLogFiles[instanceId] || registerChangedLogFile(instanceId);
    if (file) {
      onLog?.(`[INFO] Tailing log file: ${path.basename(file)}`);
      tail = tailFile(file, handleLine);
      return;
    }
    if (++attempts < TAIL_ATTACH_ATTEMPTS) {
      retryTimer = setTimeout(attach, RETRY_INTERVAL_MS);
      return;
    }
    console.warn(`[ark-logging] Could not find the log file for ${instanceId} after ${TAIL_ATTACH_ATTEMPTS} s; not tailing`);
    onLog?.('[WARN] Could not detect log file for this server instance');
  };

  tailers[instanceId] = {
    close: drain => {
      if (closing) return;
      closing = true;
      clearTimeout(retryTimer);
      tail?.close(drain);
    }
  };
  retryTimer = setTimeout(attach, RETRY_INTERVAL_MS);
}

function closeTailer(instanceId: string, drain: boolean): void {
  const tailer = tailers[instanceId];
  if (!tailer) return;
  delete tailers[instanceId];
  tailer.close(drain);
}

/** Streams lines appended to `file` from now on, through fs.watch and a polling fallback. */
function tailFile(file: string, onLine: (line: string) => void): Tailer {
  let position = sizeOf(file) ?? 0;
  let decoder = new StringDecoder('utf8');
  // Text after the last newline: a line ARK has not finished writing.
  let partial = '';
  let stopped = false;

  const emit = (text: string) => {
    const lines = (partial + text).split(/\r?\n/);
    partial = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) onLine(line);
    }
  };

  const read = () => {
    const size = sizeOf(file);
    if (size === null) return;
    if (size < position) {
      // Rewritten in place (Proton reuses ShooterGame.log): start again from the top.
      position = 0;
      partial = '';
      decoder = new StringDecoder('utf8');
    }
    if (size === position) return;
    const chunk = readRange(file, position, size - position);
    position += chunk.length;
    emit(decoder.write(chunk));
  };

  const poll = () => {
    if (stopped) return;
    try {
      read();
    } catch (error) {
      // Locked for a moment (Windows) or gone; the next poll tries again.
      console.debug(`[ark-logging] Could not read ${file}:`, error);
    }
  };

  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(file, event => {
      if (event === 'change') poll();
    });
    watcher.on('error', () => console.debug('[ark-logging] fs.watch failed; relying on polling'));
  } catch {
    console.debug('[ark-logging] fs.watch unavailable; relying on polling');
  }
  // fs.watch misses changes on some filesystems.
  const pollTimer = setInterval(poll, POLL_INTERVAL_MS);

  return {
    close: drain => {
      if (stopped) return;
      if (drain) {
        poll();
        // Nothing will finish the last line once the server has exited.
        const rest = partial + decoder.end();
        partial = '';
        try {
          if (rest.trim()) onLine(rest);
        } catch (error) {
          console.debug('[ark-logging] Could not emit the last log line:', error);
        }
      }
      stopped = true;
      clearInterval(pollTimer);
      watcher?.close();
    }
  };
}

function sizeOf(file: string): number | null {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

function readRange(file: string, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try {
    const bytesRead = fs.readSync(fd, buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeQuietly(fd);
  }
}

function closeQuietly(fd: number): void {
  try {
    fs.closeSync(fd);
  } catch {
    // Already closed
  }
}
