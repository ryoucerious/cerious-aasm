import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getInstanceDir, getInstanceSaveDir } from '../../utils/ark/instance.utils';

export interface CheckpointFile {
  rel: string;
  bytes: Buffer;
}

export interface InstanceCheckpoint {
  checksum: string;
  files: CheckpointFile[];
}

/** Config and saves only. The SteamCMD tree and Proton prefix stay where they are. */
export function checkpointInstance(serverId: string): InstanceCheckpoint {
  const dir = getInstanceDir(serverId);
  const files: CheckpointFile[] = [];
  const config = path.join(dir, 'config.json');
  if (fs.existsSync(config)) files.push({ rel: 'config.json', bytes: fs.readFileSync(config) });
  collect(getInstanceSaveDir(dir), dir, files);
  return { checksum: checksumFiles(files), files };
}

export function restoreCheckpoint(serverId: string, files: CheckpointFile[]): string {
  const dir = getInstanceDir(serverId);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) {
    const rel = file.rel.replace(/\\/g, '/');
    if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) {
      throw new Error('Checkpoint path is not inside the instance.');
    }
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const temp = `${dest}.partial`;
    fs.writeFileSync(temp, file.bytes);
    fs.renameSync(temp, dest);
  }
  return checksumFiles(files);
}

export function checksumFiles(files: CheckpointFile[]): string {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort((a, b) => a.rel.localeCompare(b.rel))) {
    hash.update(file.rel.replace(/\\/g, '/'));
    hash.update(file.bytes);
  }
  return hash.digest('hex');
}

function collect(dir: string, root: string, files: CheckpointFile[]): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) collect(full, root, files);
    else files.push({ rel: path.relative(root, full).replace(/\\/g, '/'), bytes: fs.readFileSync(full) });
  }
}
