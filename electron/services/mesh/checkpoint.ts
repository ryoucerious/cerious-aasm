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

/**
 * Files of the server's own that go with it besides its config and saves: the exclusive join
 * list (copied next to the executable at every start), the record of transfer data already
 * brought into its cluster, so it is not brought in again on the destination, and its own copy of
 * the INI files, which keeps the lines added by hand that the app has no setting for.
 */
const CARRIED_FILES = [
  'config.json', 'PlayersExclusiveJoinList.txt', 'cluster-import.json',
  'Config/WindowsServer/GameUserSettings.ini', 'Config/WindowsServer/Game.ini'
];

/** The files a move sends, relative to the server directory, in checksum order. */
export function checkpointManifest(serverId: string): string[] {
  const dir = getInstanceDir(serverId);
  const rels: string[] = [];
  for (const file of CARRIED_FILES) if (fs.existsSync(path.join(dir, file))) rels.push(file);
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

/** sha256 of a file, or of its first `length` bytes. */
export async function fileDigest(file: string, length?: number): Promise<string> {
  const hash = crypto.createHash('sha256');
  if (length !== 0) {
    const range = length === undefined ? {} : { start: 0, end: length - 1 };
    for await (const chunk of fs.createReadStream(file, range)) hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/** A file the destination already holds from an earlier attempt, possibly cut off part way. */
export interface HeldFile {
  rel: string;
  size: number;
  sha256: string;
}

/**
 * Destination side. A received checkpoint is staged beside the server list, not in it, and
 * becomes the server only when its placement arrives (promoteStaged). A move that is rolled
 * back therefore leaves nothing in this node's server list.
 *
 * A new transfer starts from nothing. One that continues an interrupted move keeps what is
 * staged and says what it holds (of `rels`, when given), so the source sends only the rest.
 */
export async function beginStage(serverId: string, options: { resume?: boolean; rels?: string[] } = {}): Promise<HeldFile[] | null> {
  const dir = stagedDir(serverId);
  if (!options.resume) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    return null;
  }
  fs.mkdirSync(dir, { recursive: true });
  const staged: string[] = [];
  collect(dir, dir, staged);
  const wanted = options.rels ? new Set(options.rels.map(checkedRel)) : null;
  const held: HeldFile[] = [];
  for (const rel of staged.sort(byCodePoint)) {
    if (wanted && !wanted.has(rel)) continue;
    const file = path.join(dir, rel);
    held.push({ rel, size: fs.statSync(file).size, sha256: await fileDigest(file) });
  }
  return held;
}

/**
 * Writes a streamed file, or carries one on from byte `offset`: what is there past that point
 * is dropped first. It cannot start past the end of what it holds.
 */
export async function writeStagedFile(serverId: string, rel: string, source: NodeJS.ReadableStream, offset = 0): Promise<void> {
  const clean = checkedRel(rel);
  if (!Number.isInteger(offset) || offset < 0) throw new Error('A file can only be carried on from a whole byte.');
  const dest = path.join(stagedDir(serverId), clean);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (offset === 0) {
    await pipeline(source, fs.createWriteStream(dest));
    return;
  }
  const held = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
  if (held < offset) {
    // 409: the source asks again what is here and carries on from that.
    throw Object.assign(new Error(`Cannot carry on ${clean} from byte ${offset}: only ${held} bytes are here.`), { statusCode: 409 });
  }
  fs.truncateSync(dest, offset);
  await pipeline(source, fs.createWriteStream(dest, { flags: 'a' }));
}

/**
 * Checks that every listed file arrived and returns their checksum. Files an earlier attempt
 * left that this move does not list are dropped.
 */
export async function finishStage(serverId: string, rels: string[]): Promise<string> {
  const dir = stagedDir(serverId);
  const expected = new Set(rels.map(checkedRel));
  const received: string[] = [];
  collect(dir, dir, received);
  const missing = [...expected].filter(rel => !received.includes(rel));
  if (missing.length) throw new Error(`Files did not arrive: ${missing.join(', ')}`);
  for (const rel of received.filter(rel => !expected.has(rel))) fs.rmSync(path.join(dir, rel), { force: true });
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

/**
 * How long the files of a move that stopped arriving are kept, so the move can be carried on
 * after an outage. A transfer still writing files is never this idle.
 */
export const INCOMING_MAX_IDLE_MS = 24 * 60 * 60 * 1000;
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
