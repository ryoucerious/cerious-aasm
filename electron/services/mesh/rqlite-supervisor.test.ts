jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('path');
jest.unmock('node:path');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { RqliteSupervisor } from './rqlite-supervisor';

describe('RqliteSupervisor', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-rqlited-'));
    const binary = path.join(dir, 'rqlited');
    fs.writeFileSync(binary, '');
    process.env.RQLITE_BIN = binary;
    jest.mocked(spawn).mockReturnValue({ on: jest.fn(), stderr: { on: jest.fn() }, killed: false, kill: jest.fn() } as never);
  });

  afterEach(() => {
    delete process.env.RQLITE_BIN;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function arg(args: string[], flag: string): string | undefined {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  }

  it('listens on its own Raft port while advertising the address other nodes dial', async () => {
    await new RqliteSupervisor().start({
      nodeId: 'n1', dataDir: path.join(dir, 'data'), httpAddr: '127.0.0.1:4001',
      raftAddr: 'mesh-a.example.com:14002', raftBind: '0.0.0.0:4002', authUser: '', authPass: ''
    });

    const args = jest.mocked(spawn).mock.calls[0][1] as string[];
    expect(arg(args, '-raft-addr')).toBe('0.0.0.0:4002');
    expect(arg(args, '-raft-adv-addr')).toBe('mesh-a.example.com:14002');
    expect(arg(args, '-http-addr')).toBe('127.0.0.1:4001');
  });
});
