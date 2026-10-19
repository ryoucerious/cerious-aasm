jest.unmock('fs');
jest.unmock('path');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { safeStorage } from 'electron';
import { clearRememberedLogin, loadRememberedLogin, saveRememberedLogin } from './remembered-login.utils';

jest.mock('./platform.utils', () => ({ getDefaultInstallDir: jest.fn() }));
const { getDefaultInstallDir } = jest.requireMock('./platform.utils') as { getDefaultInstallDir: jest.Mock };

describe('remembered login', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-login-'));
    getDefaultInstallDir.mockReturnValue(dir);
    jest.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('round-trips the username and password, encrypted', () => {
    expect(saveRememberedLogin({ username: 'ada', password: 'correct horse' }, dir)).toBe(true);

    expect(loadRememberedLogin(dir)).toEqual({ username: 'ada', password: 'correct horse' });
    expect(safeStorage.encryptString).toHaveBeenCalledWith(JSON.stringify({ username: 'ada', password: 'correct horse' }));
    expect(fs.readFileSync(path.join(dir, 'remembered-login.bin')).equals(
      Buffer.from(`enc:${JSON.stringify({ username: 'ada', password: 'correct horse' })}`, 'utf8')
    )).toBe(true);
  });

  it('stores nothing when the machine cannot encrypt, and forgets on request', () => {
    saveRememberedLogin({ username: 'ada', password: 'secret' }, dir);
    jest.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

    expect(saveRememberedLogin({ username: 'ada', password: 'next' }, dir)).toBe(false);
    expect(loadRememberedLogin(dir)).toBeNull();

    jest.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    clearRememberedLogin(dir);
    expect(loadRememberedLogin(dir)).toBeNull();
  });
});
