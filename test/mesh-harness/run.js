/**
 * Three-node rqlite check. ARK is not started. The application-level cases (leader loss does not
 * stop a process, command retry, partition) live in electron/services/mesh/mesh-cluster.test.ts,
 * which shares one committed SQLite log the way a Raft commit does. This script proves the
 * shipped rqlited binary can form a cluster when it is present.
 *
 *   node test/mesh-harness/run.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

function findBinary() {
  if (process.env.RQLITE_BIN && fs.existsSync(process.env.RQLITE_BIN)) return process.env.RQLITE_BIN;
  const name = process.platform === 'win32' ? 'rqlited.exe' : 'rqlited';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const platform = process.platform === 'win32' ? 'windows' : 'linux';
  const candidate = path.join(__dirname, '..', '..', 'resources', 'rqlite', `${platform}-${arch}`, name);
  return fs.existsSync(candidate) ? candidate : null;
}

function request(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: body ? { 'Content-Type': 'application/json' } : undefined }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitReady(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const response = await request(port, 'GET', '/readyz');
      if (response.status === 200) return;
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`rqlite on ${port} did not become ready`);
}

async function main() {
  const binary = findBinary();
  if (!binary) {
    console.log('rqlited not found; skipping live cluster harness. Run node scripts/fetch-rqlite.js');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-rqlite-'));
  const children = [];
  const logs = [];
  const ports = [14001, 14011, 14021];
  const spawnNode = (args) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const note = chunk => logs.push(chunk.toString());
    child.stdout?.on('data', note);
    child.stderr?.on('data', note);
    children.push(child);
    return child;
  };
  try {
    spawnNode(['-node-id', 'A', '-http-addr', `127.0.0.1:${ports[0]}`, '-raft-addr', '127.0.0.1:14002', path.join(root, 'a')]);
    await waitReady(ports[0]);
    spawnNode(['-node-id', 'B', '-http-addr', `127.0.0.1:${ports[1]}`, '-raft-addr', '127.0.0.1:14012', '-join', '127.0.0.1:14002', path.join(root, 'b')]);
    spawnNode(['-node-id', 'C', '-http-addr', `127.0.0.1:${ports[2]}`, '-raft-addr', '127.0.0.1:14022', '-join', '127.0.0.1:14002', path.join(root, 'c')]);
    await waitReady(ports[1]);
    await waitReady(ports[2]);
    const created = await request(ports[0], 'POST', '/db/execute', JSON.stringify([['CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, note TEXT)'], ['INSERT INTO probe(note) VALUES(?)', 'from-a']]));
    if (created.status !== 200) throw new Error(created.body + '\n' + logs.join('').slice(-2000));
    const read = await request(ports[2], 'POST', '/db/query?level=weak', JSON.stringify(['SELECT note FROM probe']));
    if (!read.body.includes('from-a')) throw new Error(`node C did not see the write: ${read.body}\n${logs.join('').slice(-2000)}`);
    const incremental = await request(ports[1], 'POST', '/db/execute', JSON.stringify([['INSERT INTO probe(note) VALUES(?)', 'later']]));
    if (incremental.status !== 200) throw new Error(incremental.body);
    let caughtUp = '';
    for (let i = 0; i < 20; i++) {
      const readBack = await request(ports[2], 'POST', '/db/query?level=none', JSON.stringify(['SELECT note FROM probe']));
      caughtUp = readBack.body;
      if (caughtUp.includes('later')) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!caughtUp.includes('later')) throw new Error(`node C missed the incremental write: ${caughtUp}`);
    children[0].kill();
    await new Promise(resolve => setTimeout(resolve, 1500));
    const stillThere = await request(ports[2], 'POST', '/db/query?level=none', JSON.stringify(['SELECT note FROM probe']));
    if (!stillThere.body.includes('from-a') || !stillThere.body.includes('later')) {
      throw new Error(`node C lost committed rows after the leader process exited: ${stillThere.body}`);
    }
    console.log('Leader process stopped. Surviving rqlite nodes were not asked to stop any game process.');
    console.log('Mesh harness passed.');
  } finally {
    for (const child of children) {
      try { child.kill(); } catch { /* already gone */ }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* Windows may still hold the data files */ }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
