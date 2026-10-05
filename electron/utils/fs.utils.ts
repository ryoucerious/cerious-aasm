import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

const RENAME_RETRIES = 5;
const RENAME_RETRY_DELAY_MS = 50;

// Windows antivirus and the search indexer briefly hold freshly written files open, which
// fails a rename with one of these codes even though nothing is wrong.
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES']);

const sleepCell = new Int32Array(new SharedArrayBuffer(4));

/**
 * Write via temp file + fsync + rename so a crash never leaves a truncated file, except in the
 * copy fallback taken when the rename keeps failing.
 */
export function writeFileAtomic(filePath: string, data: string | Buffer, options: { mode?: number } = {}): void {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  );
  const fd = fs.openSync(tempPath, 'wx', options.mode);
  try {
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    moveFile(tempPath, filePath);
  } catch (error) {
    removeQuietly(tempPath);
    throw error;
  }
}

export function writeJsonAtomic(filePath: string, value: unknown, options: { mode?: number } = {}): void {
  writeFileAtomic(filePath, JSON.stringify(value, null, 2), options);
}

/** JSON.parse a file; on parse failure move it aside to `<file>.corrupt-<timestamp>` and return undefined. */
export function readJsonOrQuarantine<T>(filePath: string): T | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }

  try {
    // Notepad and PowerShell 5 save UTF-8 with a byte order mark, which JSON.parse rejects.
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as T;
  } catch {
    // The parser's message quotes file content, which may include passwords, so it is not logged.
    const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
    moveFile(filePath, quarantinePath);
    console.error(`[fs-utils] ${filePath} was not valid JSON; moved it to ${quarantinePath}`);
    return undefined;
  }
}

/** Rename, retried through a scanner's brief lock, then copy + delete if the rename keeps failing. */
export function moveFile(from: string, to: string): void {
  if (renameWithRetry(from, to)) {
    return;
  }
  console.warn(`[fs-utils] Renaming onto ${to} kept failing (a scanner may hold either file); copying instead`);
  fs.copyFileSync(from, to);
  removeQuietly(from);
}

function renameWithRetry(from: string, to: string): boolean {
  for (let attempt = 0; attempt <= RENAME_RETRIES; attempt++) {
    if (attempt > 0) {
      Atomics.wait(sleepCell, 0, 0, RENAME_RETRY_DELAY_MS);
    }
    try {
      fs.renameSync(from, to);
      return true;
    } catch (error) {
      if (!TRANSIENT_RENAME_ERRORS.has((error as NodeJS.ErrnoException).code ?? '')) {
        throw error;
      }
    }
  }
  return false;
}

function removeQuietly(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Best effort: a stray file is harmless and must not mask the caller's outcome.
  }
}

/**
 * Removes a directory tree. fs.rm unlinks symlinks and junctions instead of recursing through them,
 * so a junction into the shared install (Content, Engine, RedpointEOS, Plugins) goes without the
 * game files it points at.
 */
export async function removeDirectory(dirPath: string): Promise<void> {
  await fs.promises.rm(dirPath, { recursive: true, force: true });
}

/** Copies a tree of plain files and folders, such as an extracted archive, replacing existing files. */
export async function copyDirectory(source: string, destination: string): Promise<void> {
  await fs.promises.mkdir(destination, { recursive: true });
  for (const entry of await fs.promises.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(from, to);
    } else {
      await fs.promises.copyFile(from, to);
    }
  }
}
