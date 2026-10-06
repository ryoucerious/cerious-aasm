jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('path');
jest.unmock('crypto');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureNodeIdentity, readNodeIdentity } from './node-identity';

jest.mock('../../utils/platform.utils', () => ({
  getDefaultInstallDir: jest.fn(),
  getFreeMemory: jest.fn(() => 1024),
  getPlatform: jest.fn(() => 'windows'),
  isRunningInDocker: jest.fn(() => false)
}));

import { getDefaultInstallDir } from '../../utils/platform.utils';

describe('node identity', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-node-'));
    jest.mocked(getDefaultInstallDir).mockReturnValue(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates a local node id without a mesh id and does not start a store', () => {
    expect(readNodeIdentity()).toBeNull();
    const created = ensureNodeIdentity('Desk');
    expect(created.nodeId).toBeTruthy();
    expect(created.meshId).toBe('');
    expect(created.name).toBe('Desk');
    expect(ensureNodeIdentity('Other').nodeId).toBe(created.nodeId);
    expect(fs.existsSync(path.join(dir, 'mesh', 'rqlite'))).toBe(false);
  });

  // A container's host name is its container id.
  describe('its first name', () => {
    const saved = process.env.AASM_NODE_NAME;
    afterEach(() => {
      if (saved === undefined) delete process.env.AASM_NODE_NAME;
      else process.env.AASM_NODE_NAME = saved;
    });

    it('comes from AASM_NODE_NAME when it is set', () => {
      process.env.AASM_NODE_NAME = '  Basement Box ';

      expect(ensureNodeIdentity().name).toBe('Basement Box');
    });

    it('is the host name otherwise', () => {
      delete process.env.AASM_NODE_NAME;

      expect(ensureNodeIdentity().name).toBe(os.hostname());
    });
  });
});
