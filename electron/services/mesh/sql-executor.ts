/**
 * The SQL surface both rqlite and the test database implement.
 *
 * Strong operations are the ones that must hit a Raft quorum. `none` is a local replica read,
 * which is what login uses so a partition does not force every sign-in through the leader.
 */
export type Consistency = 'strong' | 'none';

export interface ExecutorStatus {
  leader: boolean;
  voters: number;
  hasQuorum: boolean;
  leaderNodeId: string | null;
}

export interface SqlExecutor {
  exec(sql: string, params?: unknown[], consistency?: Consistency): Promise<number>;
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[], consistency?: Consistency): Promise<T[]>;
  status(): Promise<ExecutorStatus>;
}

/** Opens the WASM SQLite the rest of the app already uses, so mesh tests share one driver. */
export function openSqliteDatabase(file: string): SqliteHandle {
  const { Database } = require('node-sqlite3-wasm') as typeof import('node-sqlite3-wasm');
  return new Database(file) as SqliteHandle;
}

export interface SqliteHandle {
  run(sql: string, values?: unknown[]): { changes?: number } | void;
  all(sql: string, values?: unknown[]): unknown[];
  exec(sql: string): void;
  changes?: number;
  close(): void;
}

export class SqliteExecutor implements SqlExecutor {
  constructor(private readonly db: SqliteHandle, private readonly view: ExecutorStatus = {
    leader: true, voters: 1, hasQuorum: true, leaderNodeId: null
  }) {}

  async exec(sql: string, params: unknown[] = [], consistency: Consistency = 'strong'): Promise<number> {
    this.assertQuorum(consistency);
    const result = this.db.run(sql, params) as { changes?: number } | void;
    if (result && typeof result.changes === 'number') return result.changes;
    return this.db.changes ?? 0;
  }

  async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = [], consistency: Consistency = 'none'): Promise<T[]> {
    this.assertQuorum(consistency);
    return this.db.all(sql, params) as T[];
  }

  async status(): Promise<ExecutorStatus> {
    return this.view;
  }

  /** Test double: the same committed database, with this node's view of quorum flipped. */
  withView(view: ExecutorStatus): SqliteExecutor {
    return new SqliteExecutor(this.db, view);
  }

  private assertQuorum(consistency: Consistency): void {
    if (consistency === 'strong' && !this.view.hasQuorum) {
      throw new Error('Mesh has no quorum');
    }
  }
}
