import * as http from 'http';
import type { Consistency, ExecutorStatus, SqlExecutor } from './sql-executor';

interface RqliteResult {
  columns?: string[];
  values?: unknown[][];
  error?: string;
  rows_affected?: number;
}

interface RqliteBody {
  results?: RqliteResult[];
  error?: string;
}

/**
 * HTTP client for the local rqlited. SQL from other nodes arrives as Raft log entries, not as
 * requests to this port; the supervisor binds it to loopback.
 */
export class RqliteClient implements SqlExecutor {
  constructor(
    private readonly baseUrl: string,
    private readonly authUser: string,
    private readonly authPass: string,
    private readonly nodeId: string
  ) {}

  async exec(sql: string, params: unknown[] = [], consistency: Consistency = 'strong'): Promise<number> {
    const body = await this.post('/db/execute', [[sql, ...params]], consistency);
    const first = body.results?.[0];
    if (first?.error) throw new Error(first.error);
    return first?.rows_affected ?? 0;
  }

  async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = [], consistency: Consistency = 'none'): Promise<T[]> {
    const body = await this.post('/db/query', [[sql, ...params]], consistency);
    const first = body.results?.[0];
    if (first?.error) throw new Error(first.error);
    const columns = first?.columns || [];
    return (first?.values || []).map(values => {
      const row: Record<string, unknown> = {};
      columns.forEach((column, index) => { row[column] = values[index]; });
      return row as T;
    });
  }

  async status(): Promise<ExecutorStatus> {
    const raw = await this.get('/status');
    // rqlited always sends `store.leader`; with no leader its fields are empty strings.
    const store = (raw.store || {}) as {
      leader?: { node_id?: string; addr?: string };
      nodes?: Array<{ id?: string; suffrage?: string }>;
    };
    const nodes = store.nodes || [];
    const voters = nodes.filter(node => node.suffrage !== 'nonvoter').length || 1;
    const leaderId = store.leader?.node_id || null;
    return {
      leader: leaderId === this.nodeId,
      voters,
      hasQuorum: Boolean(leaderId),
      leaderNodeId: leaderId
    };
  }

  /** The cluster's members, at the Raft addresses its configuration holds for them. */
  async members(): Promise<Array<{ id: string; addr: string; voter: boolean }>> {
    const raw = await this.get('/status');
    const store = (raw.store || {}) as { nodes?: Array<{ id?: string; addr?: string; suffrage?: string }> };
    return (store.nodes || [])
      .filter(node => typeof node.id === 'string' && typeof node.addr === 'string')
      .map(node => ({ id: node.id!, addr: node.addr!, voter: node.suffrage !== 'nonvoter' }));
  }

  /**
   * True once rqlited answers. By default it must also see a leader; a node that restarts
   * cut off from the others never does, so resuming passes requireLeader: false.
   */
  async ready(options: { requireLeader?: boolean } = {}): Promise<boolean> {
    try {
      const response = await this.request('GET', options.requireLeader === false ? '/readyz?noleader' : '/readyz');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * True once this node has applied every entry the leader had committed when asked. Right after a
   * restart it serves its snapshot until it has, and a read then can be older than the mesh.
   */
  async caughtUp(): Promise<boolean> {
    try {
      const response = await this.request('GET', '/readyz?sync&timeout=2s');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async removeMember(nodeId: string): Promise<void> {
    // DELETE: rqlited answers 405 to a POST here, which left removed nodes voting.
    const response = await this.request('DELETE', '/remove', JSON.stringify({ id: nodeId }));
    if (response.status >= 400) {
      // rqlited says why in the body: "not leader", "leadership lost", a node it does not know.
      const reason = response.body.toString('utf8').trim().slice(0, 200);
      throw new Error(`rqlite remove failed (${response.status})${reason ? `: ${reason}` : ''}`);
    }
  }

  async backup(): Promise<Buffer> {
    const response = await this.request('GET', '/db/backup');
    if (response.status !== 200) throw new Error(`rqlite backup failed (${response.status})`);
    return response.body;
  }

  private async post(pathname: string, statements: unknown[], consistency: Consistency): Promise<RqliteBody> {
    const level = consistency === 'strong' ? 'strong' : 'none';
    const response = await this.request('POST', `${pathname}?level=${level}`, JSON.stringify(statements));
    if (response.status >= 400) throw new Error(`rqlite ${pathname} failed (${response.status})`);
    const parsed = JSON.parse(response.body.toString('utf8')) as RqliteBody;
    if (parsed.error) throw new Error(parsed.error);
    return parsed;
  }

  private async get(pathname: string): Promise<Record<string, unknown>> {
    const response = await this.request('GET', pathname);
    if (response.status >= 400) throw new Error(`rqlite ${pathname} failed (${response.status})`);
    return JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
  }

  private request(method: string, pathname: string, payload?: string): Promise<{ status: number; body: Buffer }> {
    const url = new URL(pathname, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
    const headers: Record<string, string> = {};
    if (this.authUser) {
      headers.Authorization = `Basic ${Buffer.from(`${this.authUser}:${this.authPass}`).toString('base64')}`;
    }
    if (payload) {
      headers['Content-Type'] = 'application/json';
      // Node frames a DELETE's body only with a length; without one rqlited reads none.
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    return new Promise((resolve, reject) => {
      const req = http.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}
