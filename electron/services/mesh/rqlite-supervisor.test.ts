// Real files, but the executable check and chmod are set per test: this runs on Windows too.
jest.mock('fs', () => ({ ...jest.requireActual('fs'), accessSync: jest.fn(), chmodSync: jest.fn() }));
jest.unmock('path');
jest.unmock('node:path');
jest.mock('child_process', () => ({ spawn: jest.fn(), spawnSync: jest.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { spawn, spawnSync } from 'child_process';
import { RqliteSupervisor, ensureExecutable, rqliteProblem } from './rqlite-supervisor';

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

  // An rqlited that could not start crashed the whole app mid-join, leaving the member holding
  // a record of a machine that never arrived.
  it('reports a process that cannot be started, instead of taking the app down', async () => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), killed: false, kill: jest.fn() });
    jest.mocked(spawn).mockReturnValue(child as never);
    const supervisor = new RqliteSupervisor();
    await supervisor.start({
      nodeId: 'n1', dataDir: path.join(dir, 'data'), httpAddr: '127.0.0.1:4001',
      raftAddr: '10.0.0.1:4002', raftBind: '0.0.0.0:4002', authUser: '', authPass: ''
    });

    expect(() => child.emit('error', Object.assign(new Error('spawn rqlited EACCES'), { code: 'EACCES' }))).not.toThrow();

    expect(supervisor.failure()).toContain('EACCES');
  });

  describe('making sure rqlited can run', () => {
    afterEach(() => {
      jest.mocked(fs.accessSync).mockReset();
      jest.mocked(fs.chmodSync).mockReset();
    });

    // The Linux binaries shipped without the executable bit.
    it('makes it executable when it was installed without the bit', () => {
      const access = jest.mocked(fs.accessSync).mockImplementationOnce(() => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); });
      const chmod = jest.mocked(fs.chmodSync);

      ensureExecutable('/opt/aasm/resources/rqlite/linux-amd64/rqlited', 'linux');

      expect(chmod).toHaveBeenCalledWith('/opt/aasm/resources/rqlite/linux-amd64/rqlited', 0o755);
      expect(access).toHaveBeenCalledTimes(2);
    });

    it('says how to fix one it cannot make executable', () => {
      jest.mocked(fs.accessSync).mockImplementation(() => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); });
      jest.mocked(fs.chmodSync).mockImplementation(() => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); });

      expect(() => ensureExecutable('/opt/aasm/rqlited', 'linux')).toThrow('chmod +x "/opt/aasm/rqlited"');
    });

    it('leaves Windows, which has no executable bit, alone', () => {
      const access = jest.mocked(fs.accessSync);
      const chmod = jest.mocked(fs.chmodSync);

      ensureExecutable('C:\\aasm\\rqlited.exe', 'win32');

      expect(access).not.toHaveBeenCalled();
      expect(chmod).not.toHaveBeenCalled();
    });

    it('finds nothing wrong with one that runs', () => {
      jest.mocked(spawnSync).mockReturnValue({ status: 0, stdout: Buffer.from('rqlited v10.5.2'), stderr: Buffer.alloc(0) } as never);

      expect(rqliteProblem()).toBeNull();
      expect(spawnSync).toHaveBeenCalledWith(process.env.RQLITE_BIN, ['-version'], expect.objectContaining({ timeout: expect.any(Number) }));
    });

    // A copy for another processor architecture, say.
    it('says why one that is there does not run', () => {
      jest.mocked(spawnSync).mockReturnValue({ status: null, error: Object.assign(new Error('spawnSync rqlited ENOEXEC'), { code: 'ENOEXEC' }) } as never);

      expect(rqliteProblem()).toMatch(/could not run.*ENOEXEC/);
    });

    it('says when it is missing', () => {
      expect(rqliteProblem(null)).toMatch(/The mesh database is missing from this install/);
    });
  });
});
