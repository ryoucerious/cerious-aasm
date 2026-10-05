import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { ClusterStorageProvider, PathValidation } from './cluster-storage';

export interface CommittedObject {
  key: string;
  version: number;
  hash: string;
  size: number;
  committed: boolean;
  tombstone: boolean;
}

/**
 * Purpose-built transfer store. A file is invisible until a commit record exists, deletions are
 * tombstones so a late replica cannot resurrect them, and a repeated commit of the same bytes
 * does not create another version.
 */
export class ManagedTransferStore {
  authorityAvailable = true;
  private readonly objects = new Map<string, CommittedObject[]>();
  private readonly pending = new Map<string, { hash: string; size: number; seen: number }>();

  observe(key: string, bytes: Buffer): 'pending' | 'stable' {
    const hash = sha256(bytes);
    const prev = this.pending.get(key);
    if (!prev || prev.hash !== hash || prev.size !== bytes.length) {
      this.pending.set(key, { hash, size: bytes.length, seen: 1 });
      return 'pending';
    }
    prev.seen += 1;
    return prev.seen >= 2 ? 'stable' : 'pending';
  }

  commit(key: string, bytes: Buffer): CommittedObject {
    if (!this.authorityAvailable) {
      throw new Error('Storage authority is unavailable. Transfers are degraded; game servers keep running.');
    }
    const hash = sha256(bytes);
    const visible = this.visible(key);
    if (visible && visible.hash === hash && visible.size === bytes.length) {
      return visible;
    }
    const versions = this.objects.get(key) || [];
    const version = (versions[versions.length - 1]?.version || 0) + 1;
    const obj: CommittedObject = { key, version, hash, size: bytes.length, committed: true, tombstone: false };
    versions.push(obj);
    this.objects.set(key, versions);
    this.pending.delete(key);
    return obj;
  }

  /** Only a committed, non-tombstoned version is visible. Pending bytes are not. */
  visible(key: string): CommittedObject | null {
    const versions = this.objects.get(key) || [];
    for (let i = versions.length - 1; i >= 0; i--) {
      const obj = versions[i];
      if (obj.tombstone) return null;
      if (obj.committed) return obj;
    }
    return null;
  }

  consume(key: string): CommittedObject {
    const versions = this.objects.get(key) || [];
    const tombstone: CommittedObject = {
      key,
      version: (versions[versions.length - 1]?.version || 0) + 1,
      hash: '',
      size: 0,
      committed: true,
      tombstone: true
    };
    versions.push(tombstone);
    this.objects.set(key, versions);
    return tombstone;
  }
}

/** Temp file then rename, so readers never see a half-written destination. */
export function materializeAtomic(dir: string, name: string, bytes: Buffer): string {
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, name);
  const temp = path.join(dir, `.${name}.${process.pid}.partial`);
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, finalPath);
  return finalPath;
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** One store per process. Authority loss degrades transfers and does not stop ARK. */
export const meshTransferStore = new ManagedTransferStore();

export function managedStorageProvider(dir: string, store: ManagedTransferStore = meshTransferStore): ClusterStorageProvider {
  return {
    mode: 'managed',
    validate(target: string = dir): PathValidation {
      if (!store.authorityAvailable) {
        return {
          ok: false,
          latencyMs: 0,
          identity: '',
          error: 'Storage authority is unavailable. Transfers are degraded; game servers keep running.'
        };
      }
      const started = Date.now();
      try {
        const probe = Buffer.from(`aasm-managed-${started}`);
        const committed = store.commit('.probe', probe);
        const written = materializeAtomic(target, '.aasm-managed-probe', probe);
        fs.unlinkSync(written);
        store.consume('.probe');
        if (committed.hash !== sha256(probe)) {
          return { ok: false, latencyMs: Date.now() - started, identity: '', error: 'Checksum did not match.' };
        }
        return { ok: true, latencyMs: Date.now() - started, identity: committed.hash };
      } catch (error) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          identity: '',
          error: error instanceof Error ? error.message : 'Managed storage validation failed'
        };
      }
    }
  };
}
