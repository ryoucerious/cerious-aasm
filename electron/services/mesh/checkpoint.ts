import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { getInstanceDir, getInstanceSaveDir, getInstancesBaseDir } from '../../utils/ark/instance.utils';

/**
 * A move's checkpoint is the server's config and saves. The SteamCMD tree and Proton prefix stay
 * where they are; the destination recreates the prefix from the instance id. Files are streamed,
 * never held in memory whole, so a large world moves like a small one.
 *
 * The checksum is sha256 over each relative path then its bytes, paths in code-point order, so
 * both ends compute it the same way whatever their locale.
 */

/** The files a move sends, relative to the server directory, in checksum order. */
export function checkpointManifest(serverId: string): string[] {
  const dir = getInstanceDir(serverId);
  const rels: string[] = [];
  if (fs.existsSync(path.join(dir, 'config.json'))) rels.push('config.json');
  collect(getInstanceSaveDir(dir), dir, rels);
  return rels.sort(byCodePoint);
}

/** Streams the listed files under `root` through one hash. */
export async function checksumTree(root: string, rels: string[]): Promise<string> {
  const hash = crypto.createHash('sha256');
  for (const rel of [...rels].sort(byCodePoint)) {
    hash.update(rel);
    for await (const chunk of fs.createReadStream(path.join(root, rel))) hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/**
 * Destination side. A received checkpoint is staged beside the server list, not in it, and
 * becomes the server only when its placement arrives (promoteStaged). A move that is rolled
 * back therefore leaves nothing in this node's server list.
 */
export function beginStage(serverId: string): void {
  const dir = stagedDir(serverId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

export async function writeStagedFile(serverId: string, rel: string, source: NodeJS.ReadableStream): Promise<void> {
  const clean = checkedRel(rel);
  const dest = path.join(stagedDir(serverId), clean);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(source, fs.createWriteStream(dest));
}

/** Checks that exactly the listed files arrived and returns their checksum. */
export async function finishStage(serverId: string, rels: string[]): Promise<string> {
  const dir = stagedDir(serverId);
  const expected = new Set(rels.map(checkedRel));
  const received: string[] = [];
  collect(dir, dir, received);
  const missing = [...expected].filter(rel => !received.includes(rel));
  if (missing.length) throw new Error(`Files did not arrive: ${missing.join(', ')}`);
  const extra = received.filter(rel => !expected.has(rel));
  if (extra.length) throw new Error(`Files are not part of the move: ${extra.join(', ')}`);
  return checksumTree(dir, [...expected]);
}

/** Turns a staged checkpoint into the server directory. A copy already there is archived first. */
export function promoteStaged(serverId: string): boolean {
  const staged = stagedDir(serverId);
  if (!fs.existsSync(staged)) return false;
  archiveInstance(serverId);
  const dir = getInstanceDir(serverId);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.renameSync(staged, dir);
  return true;
}

/** Moves a server directory out of the server list, keeping its files. Null when there is none. */
export function archiveInstance(serverId: string): string | null {
  const dir = getInstanceDir(serverId);
  if (!fs.existsSync(dir)) return null;
  const dest = path.join(meshSavedDir(), 'MeshMoved', `${serverId}-${Date.now()}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(dir, dest);
  return dest;
}

/** Longer than one move may take; a transfer still writing files is never this idle. */
export const INCOMING_MAX_IDLE_MS = 2 * 60 * 60 * 1000;
/** How long the copy a server left behind when it moved away is kept. */
export const MOVED_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Removes the files of moves that stopped arriving (nothing written for INCOMING_MAX_IDLE_MS),
 * and copies set aside more than MOVED_MAX_AGE_MS ago. Anything not named by archiveInstance is
 * left alone. Returns the folders it removed.
 */
export function pruneMeshFolders(now = Date.now()): string[] {
  const removed: string[] = [];
  const incoming = path.join(meshSavedDir(), 'MeshIncoming');
  for (const name of children(incoming)) {
    const dir = path.join(incoming, name);
    if (now - newestWrite(dir) <= INCOMING_MAX_IDLE_MS) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  const moved = path.join(meshSavedDir(), 'MeshMoved');
  for (const name of children(moved)) {
    const setAsideAt = Number(/-(\d{13})$/.exec(name)?.[1]);
    if (!Number.isFinite(setAsideAt) || now - setAsideAt <= MOVED_MAX_AGE_MS) continue;
    fs.rmSync(path.join(moved, name), { recursive: true, force: true });
    removed.push(path.join(moved, name));
  }
  return removed;
}

function children(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

/** The latest modification time of anything under `target`, itself included. */
function newestWrite(target: string): number {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs.readdirSync(target).reduce((latest, name) => Math.max(latest, newestWrite(path.join(target, name))), stat.mtimeMs);
}

/** Next to the server list, so staging and archiving are renames on the same disk. */
function meshSavedDir(): string {
  return path.dirname(getInstancesBaseDir());
}

function stagedDir(serverId: string): string {
  getInstanceDir(serverId); // rejects an id that is not a plain directory name
  return path.join(meshSavedDir(), 'MeshIncoming', serverId);
}

/** A relative path with forward slashes that cannot leave the server directory. */
function checkedRel(rel: string): string {
  const clean = String(rel || '').replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.split('/').some(part => part === '..' || part === '')) {
    throw new Error('Checkpoint path is not inside the instance.');
  }
  return clean;
}

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function collect(dir: string, root: string, rels: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) collect(full, root, rels);
    else rels.push(path.relative(root, full).replace(/\\/g, '/'));
  }
}
