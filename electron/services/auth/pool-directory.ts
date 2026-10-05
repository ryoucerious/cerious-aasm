import { ROLE_IDS } from '../../types/auth.types';
import { userDatabaseService } from './user-database.service';
import { getAllInstancesSync } from '../../utils/ark/instance.utils';
import { instanceChanges } from '../../utils/ark/instance-changes';
import type { PoolInstance, PoolUser } from './pool-access';

/**
 * Who is in which pool and which server belongs where, held in memory for the broadcast path.
 *
 * Broadcasts arrive many times a second while a server writes its log, so they must not touch
 * the database. The snapshot is dropped whenever an account or a server config changes and
 * reloads on the next use; a short maximum age covers any change that forgot to say so.
 */

export interface PoolSnapshot {
  users: PoolUser[];
  instances: Array<{ id: string } & PoolInstance>;
  /** False when no active non-admin account exists: nothing needs scoping. */
  scoped: boolean;
}

const MAX_AGE_MS = 30_000;
const RETRY_AFTER_FAILURE_MS = 5_000;
/** What the broadcast path gets while the directory cannot be read: admins and owners only. */
const UNAVAILABLE: PoolSnapshot = { users: [], instances: [], scoped: true };

export class PoolDirectory {
  private cached: { snapshot: PoolSnapshot; at: number } | null = null;
  private failedAt: number | null = null;
  private warned = false;

  constructor(
    private readonly load: () => PoolSnapshot = loadFromDatabase,
    private readonly now: () => number = Date.now
  ) {}

  invalidate(): void {
    this.cached = null;
  }

  snapshot(): PoolSnapshot {
    const now = this.now();
    if (this.cached && now - this.cached.at < MAX_AGE_MS) return this.cached.snapshot;
    if (this.failedAt !== null && now - this.failedAt < RETRY_AFTER_FAILURE_MS) return UNAVAILABLE;
    try {
      const snapshot = this.load();
      this.cached = { snapshot, at: now };
      this.failedAt = null;
      this.warned = false;
      return snapshot;
    } catch (error) {
      this.failedAt = now;
      if (!this.warned) {
        console.warn('[pool-directory] Could not read accounts or servers; only admins receive pool broadcasts until it recovers:', error);
        this.warned = true;
      }
      return UNAVAILABLE;
    }
  }
}

function loadFromDatabase(): PoolSnapshot {
  const users = userDatabaseService.listUsers()
    .filter(user => user.active)
    .map(user => ({ id: user.id, roleId: user.roleId, ownerUserId: user.ownerUserId }));
  const scoped = users.some(user => user.roleId !== ROLE_IDS.ADMIN);
  const instances = scoped
    ? getAllInstancesSync().map(instance => ({
        id: instance.id as string,
        operatorUserId: instance.operatorUserId ?? null,
        managerUserId: instance.managerUserId ?? null
      }))
    : [];
  return { users, instances, scoped };
}

export const poolDirectory = new PoolDirectory();
instanceChanges.on('changed', () => poolDirectory.invalidate());
