import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { managedStorageProvider } from './managed-storage';

export interface PathValidation {
  ok: boolean;
  latencyMs: number;
  identity: string;
  error?: string;
}

/**
 * Checks a directory the operator has already mounted (local disk, or SMB/NFS on a private path).
 * The UI does not suggest exposing that path on the public internet.
 */
export function validateSharedPath(dir: string): PathValidation {
  const started = Date.now();
  const probe = path.join(dir, `.aasm-probe-${randomUUID()}`);
  const renamed = `${probe}.renamed`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, 'aasm');
    fs.renameSync(probe, renamed);
    const text = fs.readFileSync(renamed, 'utf8');
    fs.unlinkSync(renamed);
    if (text !== 'aasm') {
      return { ok: false, latencyMs: Date.now() - started, identity: '', error: 'Readback after rename did not match.' };
    }
    let identity = dir;
    try {
      const stat = fs.statSync(dir) as fs.Stats & { dev?: number; ino?: number };
      identity = `${stat.dev ?? 0}:${stat.ino ?? 0}`;
    } catch {
      identity = dir;
    }
    return { ok: true, latencyMs: Date.now() - started, identity };
  } catch (error) {
    try { fs.unlinkSync(probe); } catch { /* already renamed or never written */ }
    try { fs.unlinkSync(renamed); } catch { /* not created */ }
    return {
      ok: false,
      latencyMs: Date.now() - started,
      identity: '',
      error: error instanceof Error ? error.message : 'Path validation failed'
    };
  }
}

export interface ClusterStorageProvider {
  readonly mode: 'shared-path' | 'managed';
  validate(dir: string): PathValidation | Promise<PathValidation>;
}

export const sharedPathProvider: ClusterStorageProvider = {
  mode: 'shared-path',
  validate: validateSharedPath
};

export function providerForProfile(mode: 'shared-path' | 'managed', dir: string): ClusterStorageProvider {
  return mode === 'managed' ? managedStorageProvider(dir) : sharedPathProvider;
}
