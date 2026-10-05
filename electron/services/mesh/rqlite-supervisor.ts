import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface RqliteStartOptions {
  nodeId: string;
  dataDir: string;
  httpAddr: string;
  raftAddr: string;
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
      throw new Error('rqlited was not found. Run node scripts/fetch-rqlite.js, or set RQLITE_BIN.');
    }
    this.stderr = '';
    this.exited = false;
    fs.mkdirSync(options.dataDir, { recursive: true });
    const httpAdv = advertisedHttp(options.httpAddr, options.raftAddr);
    const args = [
      '-node-id', options.nodeId,
      '-http-addr', options.httpAddr,
      '-raft-addr', options.raftAddr,
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

  /** The line from rqlited that says why it stopped, once it has exited with an error. */
  failure(): string | null {
    if (!this.exited) return null;
    const line = this.stderr.split(/\r?\n/).map(entry => entry.trim()).reverse()
      .find(entry => /failed|error:/i.test(entry));
    return line || 'rqlited exited before it was ready';
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
