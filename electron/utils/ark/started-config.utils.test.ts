jest.unmock('fs');
jest.unmock('path');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { forRcon, readStartedConfig, recordStartedConfig } from './started-config.utils';

jest.mock('./instance.utils', () => ({ getInstanceDir: jest.fn() }));
import { getInstanceDir } from './instance.utils';

describe('started-config.utils', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-started-'));
    jest.mocked(getInstanceDir).mockReturnValue(dir);
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Settings saved while it runs take effect at the next start; the page shows which changed.
  it('keeps the settings a server started with, without its live figures', () => {
    recordStartedConfig('a', { id: 'a', name: 'Island', maxPlayers: 70, state: 'running', players: 12 } as never);

    expect(readStartedConfig('a')).toEqual({ id: 'a', name: 'Island', maxPlayers: 70 });
  });

  it('has nothing for a server that has not started since', () => {
    expect(readStartedConfig('a')).toBeNull();
  });

  // The running server still answers on the port, and to the password, it started with.
  it('connects RCON with the port and password the server started with', () => {
    recordStartedConfig('a', { id: 'a', rconPort: 27020, rconPassword: 'old', serverAdminPassword: 'admin-old' } as never);

    expect(forRcon({ id: 'a', rconPort: 27030, rconPassword: 'new', serverAdminPassword: 'admin-new', name: 'Island' } as never))
      .toEqual({ id: 'a', rconPort: 27020, rconPassword: 'old', serverAdminPassword: 'admin-old', name: 'Island' });
  });

  it('connects RCON with the saved settings when the server has not started since', () => {
    const current = { id: 'a', rconPort: 27030, rconPassword: 'new' } as never;

    expect(forRcon(current)).toBe(current);
  });
});
