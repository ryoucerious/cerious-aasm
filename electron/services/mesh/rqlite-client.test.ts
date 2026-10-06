import * as http from 'http';
import type { AddressInfo } from 'net';
import { RqliteClient } from './rqlite-client';

// Bodies captured from rqlited v10.5.2. A node with no leader still sends `store.leader`,
// with empty strings, and a read-only node is listed with suffrage "nonvoter".
const LEADERLESS_STATUS = {
  store: { leader: { addr: '', node_id: '' }, nodes: [
    { id: 'a', addr: '10.0.0.1:4002', suffrage: 'voter' },
    { id: 'b', addr: '10.0.0.2:4002', suffrage: 'voter' }
  ] }
};
const LED_STATUS = {
  store: { leader: { addr: '10.0.0.1:4002', node_id: 'a' }, nodes: [
    { id: 'a', addr: '10.0.0.1:4002', suffrage: 'voter' },
    { id: 'b', addr: '10.0.0.2:4002', suffrage: 'voter' },
    { id: 'n', addr: '10.0.0.3:4002', suffrage: 'nonvoter' }
  ] }
};

describe('RqliteClient against rqlited responses', () => {
  let server: http.Server;
  let baseUrl = '';
  let status: unknown = LEADERLESS_STATUS;
  const requested: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requested.push(req.url || '');
      const url = new URL(req.url || '/', 'http://rqlite');
      if (url.pathname === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
        return;
      }
      if (url.pathname === '/readyz') {
        // rqlited answers 503 without a leader unless the caller passes ?noleader.
        const hasLeader = status === LED_STATUS;
        if (hasLeader || url.searchParams.has('noleader')) {
          res.writeHead(200);
          res.end('[+]node ok');
        } else {
          res.writeHead(503);
          res.end('[+]node ok\n[+]leader does not exist');
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  beforeEach(() => {
    requested.length = 0;
  });

  it('reports no quorum when rqlite has no leader', async () => {
    status = LEADERLESS_STATUS;
    const view = await new RqliteClient(baseUrl, '', '', 'a').status();
    expect(view.hasQuorum).toBe(false);
    expect(view.leaderNodeId).toBeNull();
    expect(view.leader).toBe(false);
  });

  it('reports quorum and the leader when rqlite has one', async () => {
    status = LED_STATUS;
    const view = await new RqliteClient(baseUrl, '', '', 'a').status();
    expect(view.hasQuorum).toBe(true);
    expect(view.leaderNodeId).toBe('a');
    expect(view.leader).toBe(true);
  });

  it('counts only voting members', async () => {
    status = LED_STATUS;
    const view = await new RqliteClient(baseUrl, '', '', 'b').status();
    expect(view.voters).toBe(2);
    expect(view.leader).toBe(false);
  });

  it('is ready without a leader only when the caller does not require one', async () => {
    status = LEADERLESS_STATUS;
    const client = new RqliteClient(baseUrl, '', '', 'a');
    expect(await client.ready()).toBe(false);
    expect(await client.ready({ requireLeader: false })).toBe(true);
  });
});
