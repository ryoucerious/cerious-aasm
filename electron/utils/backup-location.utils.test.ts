jest.unmock('fs');
jest.unmock('path');
jest.mock('./platform.utils', () => ({ getDefaultInstallDir: jest.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getDefaultInstallDir } from './platform.utils';
import { checkedBackupDirectory, validateBackupLocation } from './backup-location.utils';
import { BackupPathUtils } from './backup.utils';

describe('Backup location confinement (real filesystem)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-location-'));
    jest.mocked(getDefaultInstallDir).mockReturnValue(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it.each(['../escape', '/tmp', 'C:/backups', 'C:\\backups', '\\\\host\\share', 'a/../b', 'a//b', 'a\\b', 'a:stream', 'NUL', 'com1', 'a.', 'a ', {}, null, 12])('rejects unsafe input %p', value => {
    expect(() => validateBackupLocation(value)).toThrow();
  });
  it('inherits the app default, overrides per server, and isolates servers', () => {
    const server = path.join(root, 'servers', 'a1');
    fs.mkdirSync(server, { recursive: true });
    fs.writeFileSync(path.join(root, 'global-config.json'), JSON.stringify({ backupLocation: 'archive/daily' }));
    expect(BackupPathUtils.getInstanceBackupDir(server)).toBe(path.join(root, 'backups/a1/archive/daily'));
    fs.writeFileSync(path.join(server, 'backup-settings.json'), JSON.stringify({ backupLocation: 'special' }));
    expect(BackupPathUtils.getInstanceBackupDir(server)).toBe(path.join(root, 'backups/a1/special'));
    expect(checkedBackupDirectory('a2', 'special')).toBe(path.join(root, 'backups/a2/special'));
  });
  it('refuses a junction in an existing location, including after a previously safe resolution', () => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    const parent = checkedBackupDirectory('a1');
    fs.mkdirSync(parent, { recursive: true });
    expect(checkedBackupDirectory('a1', 'daily')).toBe(path.join(parent, 'daily'));
    fs.symlinkSync(outside, path.join(parent, 'daily'), 'junction');
    expect(() => checkedBackupDirectory('a1', 'daily')).toThrow(/real directories/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  it('rejects a linked backup root and persisted traversal', () => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(root, 'backups'), 'junction');
    expect(() => checkedBackupDirectory('a1')).toThrow();
    expect(() => checkedBackupDirectory('../a1')).toThrow();
  });
});
