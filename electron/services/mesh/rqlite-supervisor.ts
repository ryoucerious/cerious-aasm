import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface RqliteStartOptions {
  nodeId: string;
  dataDir: string;
  /** Where the HTTP API listens. Loopback: only this machine's AASM uses it. */
  httpAddr: string;
  /** The Raft address other nodes dial. Behind a port forward or proxy its port can differ from raftBind. */
  raftAddr: string;
  /** Where Raft listens on this machine. */
  raftBind: string;
  authUser: string;
  authPass: string;
  join?: string;
  cert?: { nodeCert: string; nodeKey: string; caCert: string };
}

/**
 * One rqlited process per AASM node. The binary is shipped per platform or pointed at with
 * RQLITE_BIN. AASM does not implement its own election; this process is the Raft node.
 */
export class RqliteSupervisor {
  private child: ChildProcess | null = null;
  private stderr = '';
  private exited = false;

  start(options: RqliteStartOptions): Promise<void> {
    const binary = findRqliteBinary();
    if (!binary) {
      throw new Error(RQLITED_MISSING);
    }
    ensureExecutable(binary);
    this.stderr = '';
    this.exited = false;
    fs.mkdirSync(options.dataDir, { recursive: true });
    const httpAdv = advertisedHttp(options.httpAddr, options.raftAddr);
    const args = [
      '-node-id', options.nodeId,
      '-http-addr', options.httpAddr,
      '-raft-addr', options.raftBind,
      '-http-adv-addr', httpAdv,
      '-raft-adv-addr', options.raftAddr
    ];
    if (options.authUser) {
      const authFile = path.join(path.dirname(options.dataDir), 'rqlite-users.json');
      fs.writeFileSync(authFile, JSON.stringify([{
        username: options.authUser,
        password: options.authPass,
        perms: ['all']
      }]), { mode: 0o600 });
      args.push('-auth', authFile);
      if (options.join) args.push('-join-as', options.authUser);
    }
    if (options.join) args.push('-join', joinTarget(options.join));
    if (options.cert) {
      args.push(
        '-node-cert', options.cert.nodeCert,
        '-node-key', options.cert.nodeKey,
        '-node-ca-cert', options.cert.caCert,
        '-node-verify-client'
      );
    }
    args.push(options.dataDir);

    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    // A binary that cannot be started (not executable, wrong architecture) reports here, not on
    // exit. Without a listener Node throws it, and the whole app exited mid-join.
    child.on('error', error => {
      if (this.child === child) this.child = null;
      this.exited = true;
      this.stderr = `${this.stderr}\nerror: rqlited could not be started: ${error.message}`.slice(-4000);
      console.error(`[mesh] rqlited could not be started: ${error.message}`);
    });
    child.stderr?.on('data', chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-4000); });
    child.on('exit', code => {
      if (this.child === child) this.child = null;
      if (code && code !== 0) {
        this.exited = true;
        console.error(`[mesh] rqlited exited ${code}: ${this.stderr}`);
      }
    });
    return Promise.resolve();
  }

  /** The latest rqlited line that says why clustering failed, even while the process is still retrying. */
  detail(): string | null {
    const lines = this.stderr.split(/\r?\n/).map(entry => entry.trim()).filter(entry => /failed|error:/i.test(entry));
    const specific = [...lines].reverse().find(entry => !/join operation canceled/i.test(entry));
    return specific || lines[lines.length - 1] || null;
  }

  /** The line from rqlited that says why it stopped, once it has exited with an error. */
  failure(): string | null {
    if (!this.exited) return null;
    return this.detail() || 'rqlited exited before it was ready';
  }

  stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.killed) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }
}

function advertisedHttp(httpAddr: string, raftAddr: string): string {
  const httpPort = httpAddr.slice(httpAddr.lastIndexOf(':') + 1);
  const raftHost = raftAddr.slice(0, raftAddr.lastIndexOf(':'));
  if (httpAddr.startsWith('0.0.0.0:') || httpAddr.startsWith('localhost:')) return `${raftHost}:${httpPort}`;
  return httpAddr;
}

function joinTarget(join: string): string {
  return join.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

const RQLITED_MISSING = 'rqlited was not found. Run node scripts/fetch-rqlite.js, or set RQLITE_BIN.';

/**
 * On Linux and macOS, makes sure rqlited may be run, setting the executable bit when it was
 * installed without one; throws, saying how to fix it, when it cannot. Windows has no such bit.
 */
export function ensureExecutable(binary: string, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') return;
  const runnable = (): boolean => {
    try {
      fs.accessSync(binary, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (runnable()) return;
  try {
    fs.chmodSync(binary, 0o755);
  } catch {
    /* said below */
  }
  if (!runnable()) {
    throw new Error(`rqlited at ${binary} is not executable, and this app could not make it so. Run: chmod +x "${binary}"`);
  }
  console.log(`[mesh] Made ${binary} executable.`);
}

/**
 * Why this machine cannot run the mesh database, or null when it can: rqlited is missing, not
 * executable, or does not run (built for another processor, say). Checked before creating or
 * joining a mesh, so nothing is recorded on a member for a machine that could never take part.
 */
export function rqliteProblem(binary: string | null = findRqliteBinary()): string | null {
  if (!binary) return RQLITED_MISSING;
  try {
    ensureExecutable(binary);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const run = spawnSync(binary, ['-version'], { timeout: 15_000, windowsHide: true });
  if (run.error || run.status !== 0) {
    const why = run.error?.message || String(run.stderr || '').trim() || `exit code ${run.status}`;
    return `rqlited at ${binary} could not run: ${why}`;
  }
  return null;
}

export function findRqliteBinary(): string | null {
  const name = process.platform === 'win32' ? 'rqlited.exe' : 'rqlited';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const platform = process.platform === 'win32' ? 'windows' : 'linux';
  const relative = path.join(`${platform}-${arch}`, name);
  const candidates = [
    process.env.RQLITE_BIN || '',
    path.join(process.resourcesPath || '', 'rqlite', relative),
    path.join(process.cwd(), 'resources', 'rqlite', relative),
    path.join(__dirname, '..', '..', '..', 'resources', 'rqlite', relative)
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}
