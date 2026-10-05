import * as fs from 'fs';
import * as path from 'path';
import * as pty from 'node-pty';
import { getDefaultInstallDir } from './platform.utils';

export interface InstallProgress {
  percent: number;
  step: string;
  message: string;
}

export interface InstallerOptions {
  command: string;
  args: string[];
  cwd: string;
  /** Turns a chunk of output into a progress report, or null when it carries none. */
  parseProgress?: (chunk: string) => InstallProgress | null;
  /** Stop the child when its output has not changed for this long. */
  stallTimeoutMs?: number;
  /** Aborting stops the child, and the run ends with an InstallCancelledError. */
  signal?: AbortSignal;
}

export const INSTALL_CANCELLED = 'Install cancelled.';

export class InstallCancelledError extends Error {
  constructor() {
    super(INSTALL_CANCELLED);
    this.name = 'InstallCancelledError';
  }
}

export const INSTALL_IN_PROGRESS = 'Another install or update is already in progress. Try again when it finishes.';

// Installer runs register here, and so do in-process steps (the SteamCMD and Proton downloads):
// without that, Cancel would look like it worked while the download kept streaming.
const cancelHandlers = new Set<() => void>();

/** Lets cancelInstaller() stop a running step. Returns the function that unregisters it. */
export function onInstallCancel(cancel: () => void): () => void {
  const handler = () => cancel();
  cancelHandlers.add(handler);
  return () => {
    cancelHandlers.delete(handler);
  };
}

export function cancelInstaller(): void {
  for (const cancel of [...cancelHandlers]) {
    try {
      cancel();
    } catch (error) {
      console.warn('[installer] A step could not be cancelled:', error);
    }
  }
}

/**
 * A reporter that never throws. Progress goes out over IPC or a socket; a failure there must not
 * cut an install short before it reports its result and its caller releases the install lock.
 */
export function reportSafely(onProgress: ((progress: InstallProgress) => void) | undefined): (progress: InstallProgress) => void {
  return progress => {
    try {
      onProgress?.(progress);
    } catch (error) {
      console.warn('[installer] Could not report progress:', error);
    }
  };
}

function lockFilePath(): string {
  return path.join(getDefaultInstallDir(), 'install.lock');
}

// While this process holds the lock it touches the file every minute. A lock left untouched for
// three is stale whatever PID it names: after a restart that PID can belong to another process.
const LOCK_HEARTBEAT_MS = 60 * 1000;
const LOCK_STALE_AFTER_MS = 3 * 60 * 1000;
// Windows PIDs are 32-bit; older versions wrote a millisecond timestamp into the lock instead.
const MAX_PID = 0xFFFFFFFF;

let heartbeat: NodeJS.Timeout | null = null;

function startHeartbeat(): void {
  heartbeat = setInterval(() => {
    const now = new Date();
    try {
      fs.utimesSync(lockFilePath(), now, now);
    } catch (error) {
      console.warn('[installer] Could not refresh the install lock:', error);
    }
  }, LOCK_HEARTBEAT_MS);
  heartbeat.unref();
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Whether another install holds the lock. It does only while the file names a running process
 * other than this one and has been touched within the last three minutes; anything else (a crash,
 * a timestamp from an older version, an unreadable file) is stale.
 */
function lockState(): 'free' | 'held' | 'stale' {
  let content: string;
  let touchedAt: number;
  try {
    touchedAt = fs.statSync(lockFilePath()).mtimeMs;
    content = String(fs.readFileSync(lockFilePath(), 'utf8'));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'free' : 'stale';
  }

  const pid = Number(content.trim());
  const namesProcess = Number.isInteger(pid) && pid > 0 && pid <= MAX_PID;
  const fresh = Date.now() - touchedAt <= LOCK_STALE_AFTER_MS;
  return namesProcess && pid !== process.pid && fresh && isProcessRunning(pid) ? 'held' : 'stale';
}

function createLockFile(): boolean {
  let fd: number;
  try {
    fd = fs.openSync(lockFilePath(), 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
  try {
    fs.writeFileSync(fd, String(process.pid));
  } catch (error) {
    fs.closeSync(fd);
    releaseInstallLock();
    throw error;
  }
  fs.closeSync(fd);
  return true;
}

/**
 * Takes the lock that every SteamCMD run shares (installs, updates, build checks). Returns false
 * when it is already held. A stale lock is taken over.
 */
export function acquireInstallLock(): boolean {
  if (heartbeat) {
    return false;
  }
  fs.mkdirSync(getDefaultInstallDir(), { recursive: true });
  let created = createLockFile();
  if (!created && lockState() === 'stale') {
    console.warn('[installer] Taking over an install lock nothing holds any more');
    releaseInstallLock();
    created = createLockFile();
  }
  if (created) {
    startHeartbeat();
  }
  return created;
}

export function releaseInstallLock(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  try {
    fs.unlinkSync(lockFilePath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[installer] Could not remove the install lock:', error);
    }
  }
}

/** For shutdown: releases the lock if this process holds it, and leaves anyone else's alone. */
export function releaseInstallLockIfHeld(): void {
  if (heartbeat) {
    releaseInstallLock();
  }
}

export function isInstallLocked(): boolean {
  return heartbeat !== null || lockState() === 'held';
}

/** At startup, removes a lock whose install is not running any more. */
export function clearStaleInstallLock(): void {
  if (lockState() === 'stale') {
    releaseInstallLock();
  }
}

/**
 * Runs one installer child in a pty. `onDone` is called exactly once: when the child exits, when
 * it cannot be started, when it stalls, or with an InstallCancelledError on cancel or abort.
 */
export function runInstaller(
  options: InstallerOptions,
  onProgress: (progress: InstallProgress) => void,
  onDone: (err: Error | null) => void
): void {
  const report = reportSafely(onProgress);
  if (options.signal?.aborted) {
    onDone(new InstallCancelledError());
    return;
  }

  let child: pty.IPty;
  try {
    child = pty.spawn(options.command, options.args, { cwd: options.cwd });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report({ percent: 0, step: 'error', message: `Failed to start process: ${message}` });
    onDone(new Error(`Failed to start process "${options.command}": ${message}`));
    return;
  }

  let output = '';
  let lastChunk = '';
  let lastPercent = 0;
  let finished = false;
  let stallTimer: NodeJS.Timeout | undefined;

  const stop = () => {
    try {
      child.kill();
    } catch (error) {
      console.warn(`[installer] Could not stop ${options.command}:`, error);
    }
  };

  const cancel = () => {
    stop();
    finish(new InstallCancelledError());
  };

  const finish = (error: Error | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(stallTimer);
    unregisterCancel();
    options.signal?.removeEventListener('abort', cancel);
    onDone(error);
  };

  const unregisterCancel = onInstallCancel(cancel);
  options.signal?.addEventListener('abort', cancel, { once: true });

  const { stallTimeoutMs } = options;
  const watchForStall = () => {
    if (!stallTimeoutMs) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      const seconds = Math.round(stallTimeoutMs / 1000);
      console.error(`[installer] ${options.command} made no progress for ${seconds} s; stopping it`);
      stop();
      finish(new Error(`${options.command} made no progress for ${seconds} s and was stopped.`));
    }, stallTimeoutMs);
  };

  child.onData(data => {
    if (finished) return;
    output += data;
    // Only new output counts: a hung SteamCMD can repeat the same status line forever.
    const chunk = data.trim();
    if (chunk && chunk !== lastChunk) {
      lastChunk = chunk;
      watchForStall();
    }
    const progress = options.parseProgress?.(data);
    if (progress && progress.percent >= lastPercent) {
      lastPercent = progress.percent;
      report(progress);
    }
  });

  child.onExit(({ exitCode }) => {
    if (finished) return;
    const steamCmdSucceeded = output.includes('Success! App') && output.includes('fully installed');
    if (exitCode !== 0 && !steamCmdSucceeded) {
      report({ percent: lastPercent, step: 'error', message: 'Failed to download.' });
      finish(new Error('Failed to download.'));
      return;
    }
    report({ percent: 100, step: 'complete', message: 'Download complete.' });
    finish(null);
  });

  watchForStall();
}
