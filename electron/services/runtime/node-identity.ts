import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getDefaultInstallDir, getFreeMemory, getPlatform, isRunningInDocker } from '../../utils/platform.utils';
import type { NodeCapabilities } from '../../types/mesh.types';

export interface NodeIdentityFile {
  nodeId: string;
  name: string;
  meshId: string;
  createdAt: number;
}

function meshDir(): string {
  return path.join(getDefaultInstallDir(), 'mesh');
}

export function nodeIdentityPath(): string {
  return path.join(meshDir(), 'node.json');
}

export function readNodeIdentity(): NodeIdentityFile | null {
  try {
    const raw = fs.readFileSync(nodeIdentityPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<NodeIdentityFile>;
    if (!parsed.nodeId || !parsed.name) return null;
    return {
      nodeId: parsed.nodeId,
      name: parsed.name,
      meshId: parsed.meshId || '',
      createdAt: parsed.createdAt || 0
    };
  } catch {
    return null;
  }
}

/** Creates node.json on first use. MeshId stays empty until this install creates or joins a mesh. */
export function ensureNodeIdentity(name?: string): NodeIdentityFile {
  const existing = readNodeIdentity();
  if (existing) return existing;
  const identity: NodeIdentityFile = {
    nodeId: randomUUID(),
    // AASM_NODE_NAME, since a container's host name is its container id. Renamed in the mesh later.
    name: (name || process.env.AASM_NODE_NAME?.trim() || os.hostname() || 'aasm-node').slice(0, 80),
    meshId: '',
    createdAt: Date.now()
  };
  writeNodeIdentity(identity);
  return identity;
}

export function writeNodeIdentity(identity: NodeIdentityFile): void {
  fs.mkdirSync(meshDir(), { recursive: true });
  const file = nodeIdentityPath();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(identity, null, 2));
  fs.renameSync(tmp, file);
}

export function collectCapabilities(): NodeCapabilities {
  let freeDiskBytes = 0;
  try {
    const statfs = (fs as unknown as { statfsSync?(p: string): { bavail: number; bsize: number } }).statfsSync;
    if (statfs) {
      const stat = statfs(getDefaultInstallDir());
      freeDiskBytes = stat.bavail * stat.bsize;
    }
  } catch {
    freeDiskBytes = 0;
  }
  const platform = getPlatform();
  return {
    platform,
    docker: isRunningInDocker(),
    proton: platform === 'linux',
    installPresent: fs.existsSync(path.join(getDefaultInstallDir(), 'AASMServer')),
    freeMemoryBytes: getFreeMemory(),
    freeDiskBytes,
    cpuPercent: 0
  };
}
