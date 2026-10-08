jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('path');
jest.unmock('crypto');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectCapabilities, ensureNodeIdentity, readNodeIdentity } from './node-identity';

jest.mock('../../utils/platform.utils', () => ({
  getDefaultInstallDir: jest.fn(),
  getFreeMemory: jest.fn(() => 1024),
  getPlatform: jest.fn(() => 'windows'),
  isRunningInDocker: jest.fn(() => false)
}));

jest.mock('../server-ports.service', () => ({ serverPortsService: { portsOpen: jest.fn(() => null) } }));
jest.mock('../../utils/server-ports.utils', () => ({
  getServerPortRanges: jest.fn(() => ({
    ranges: { game: { start: 7777, end: 7900 }, query: { start: 27015, end: 27030 }, rcon: { start: 27020, end: 27050 } },
    source: 'settings'
  }))
}));

import { getDefaultInstallDir } from '../../utils/platform.utils';
import { serverPortsService } from '../server-ports.service';

describe('node identity', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-node-'));
    jest.mocked(getDefaultInstallDir).mockReturnValue(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // A server moved onto a machine whose firewall keeps players out can't be reached: the others
  // show it on that machine's card.
  it('tells the others which ports its servers take, and whether its firewall lets players in', () => {
    jest.mocked(serverPortsService.portsOpen).mockReturnValue(false);

    expect(collectCapabilities().serverPorts).toEqual({
      ranges: { game: { start: 7777, end: 7900 }, query: { start: 27015, end: 27030 }, rcon: { start: 27020, end: 27050 } },
      portsOpen: false
    });
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
