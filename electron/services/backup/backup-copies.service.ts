import * as fs from 'fs';
import * as path from 'path';
import { loadGlobalConfig } from '../../utils/global-config.utils';
import { getDefaultInstallDir } from '../../utils/platform.utils';

/** A copy this machine keeps of the latest backup of a server on another machine of the mesh. */
export interface HeldCopy {
  serverId: string;
  serverName: string;
  fileName: string;
  size: number;
  /** The machine the server ran on when the backup was taken. */
  fromNodeId: string;
  fromNodeName: string;
  copiedAt: number;
}

/** Where the latest backup of a server here was copied to. */
export interface SentCopy {
  nodeId: string;
  nodeName: string;
  fileName: string;
  size: number;
  copiedAt: number;
}

const MANIFEST = 'copy.json';
/** A backup's own file name, never a path: what arrives from another machine stays in its folder. */
const SAFE_NAME = /^[\w.-]+\.zip$/;

/**
 * The latest backup of each server, kept on a second machine of the mesh as well, so a machine that
 * is lost does not take its servers' backups with it. Only the latest: each copy replaces the one
 * before. Held copies live under backup-copies/<serverId>; where this machine's own copies went is
 * kept under backup-copies/sent.
 */
export class BackupCopiesService {
  constructor(
    private root: () => string = () => path.join(loadGlobalConfig().serverDataDir || getDefaultInstallDir(), 'backup-copies'),
    private now: () => number = Date.now
  ) {}

  /** Fetches a copy with `fetch` into a part file, then puts it in place of the one before. */
  async hold(copy: Omit<HeldCopy, 'copiedAt'>, fetch: (dest: string) => Promise<boolean>): Promise<{ success: boolean; error?: string }> {
    if (!SAFE_NAME.test(copy.fileName) || !SAFE_NAME.test(`${copy.serverId}.zip`)) {
      return { success: false, error: 'That backup has a name a copy cannot be kept under.' };
    }
    const dir = path.join(this.root(), copy.serverId);
    fs.mkdirSync(dir, { recursive: true });
    const part = path.join(dir, `${copy.fileName}.part`);
    const fetched = await fetch(part).catch(() => false);
    if (!fetched) {
      fs.rmSync(part, { force: true });
      return { success: false, error: `Could not fetch ${copy.fileName} from ${copy.fromNodeName}.` };
    }
    if (fs.statSync(part).size !== copy.size) {
      fs.rmSync(part, { force: true });
      return { success: false, error: `The copy of ${copy.fileName} arrived incomplete.` };
    }
    fs.renameSync(part, path.join(dir, copy.fileName));
    for (const entry of fs.readdirSync(dir)) {
      if (entry !== copy.fileName && entry !== MANIFEST) fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
    fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify({ ...copy, copiedAt: this.now() }, null, 2));
    return { success: true };
  }

  drop(serverId: string): void {
    if (!SAFE_NAME.test(`${serverId}.zip`)) return;
    fs.rmSync(path.join(this.root(), serverId), { recursive: true, force: true });
  }

  /** The copies this machine keeps for servers elsewhere. */
  list(): HeldCopy[] {
    const root = this.root();
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root)
      .filter(name => name !== 'sent')
      .map(name => this.manifest(name))
      .filter((copy): copy is HeldCopy => copy !== null);
  }

  /** The file of the copy kept of a server's latest backup, or null. */
  heldPath(serverId: string): string | null {
    const copy = this.manifest(serverId);
    if (!copy) return null;
    const file = path.join(this.root(), serverId, copy.fileName);
    return fs.existsSync(file) ? file : null;
  }

  recordSent(serverId: string, sent: Omit<SentCopy, 'copiedAt'>): void {
    const dir = path.join(this.root(), 'sent');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${serverId}.json`), JSON.stringify({ ...sent, copiedAt: this.now() }, null, 2));
  }

  /** Where the latest backup of a server here was copied to, or null. */
  sent(serverId: string): SentCopy | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.root(), 'sent', `${serverId}.json`), 'utf8')) as SentCopy;
    } catch {
      return null;
    }
  }

  private manifest(serverId: string): HeldCopy | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.root(), serverId, MANIFEST), 'utf8')) as HeldCopy;
    } catch {
      return null;
    }
  }
}

export const backupCopies = new BackupCopiesService();
