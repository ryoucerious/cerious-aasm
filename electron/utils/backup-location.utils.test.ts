jest.unmock('fs');
jest.unmock('path');
jest.mock('./platform.utils', () => ({ getDefaultInstallDir: jest.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getDefaultInstallDir } from './platform.utils';
import { checkedBackupCopiesDirectory, checkedBackupDirectory, prepareBackupCopiesDirectory, prepareBackupDirectory, validateBackupLocation } from './backup-location.utils';
import { BackupPathUtils } from './backup.utils';

describe('Backup location confinement (real filesystem)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-location-'));
    jest.mocked(getDefaultInstallDir).mockReturnValue(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it.each(['../escape', 'a/../b', 'a//b', 'a\\b', 'a:stream', 'NUL', 'com1', 'a.', 'a /b', {}, null, 12])('rejects unsafe input %p', value => {
    expect(() => validateBackupLocation(value)).toThrow();
  });
  it('trims a relative folder', () => {
    expect(validateBackupLocation('  archive/daily  ')).toBe('archive/daily');
  });
  it('rejects a path that is absolute only on another platform', () => {
    const foreign = process.platform === 'win32' ? '/tmp' : 'C:/backups';
    expect(() => validateBackupLocation(foreign)).toThrow();
  });
  it('keeps a server\'s backups under an absolute path, in that server\'s own folder', () => {
    const disk = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-abs-'));
    try {
      expect(validateBackupLocation(disk)).toBe(path.resolve(disk));
      expect(checkedBackupDirectory('a1', disk)).toBe(path.join(path.resolve(disk), 'a1'));
      expect(prepareBackupDirectory('a1', disk)).toBe(path.join(path.resolve(disk), 'a1'));
      expect(fs.existsSync(path.join(disk, 'a1'))).toBe(true);
    } finally {
      fs.rmSync(disk, { recursive: true, force: true });
    }
  });
  it('rejects an absolute path that climbs out with ..', () => {
    const climbed = `${os.tmpdir()}${path.sep}aasm${path.sep}..${path.sep}other`;
    expect(() => validateBackupLocation(climbed)).toThrow();
  });
  it('refuses a junction used as an absolute backup location', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-outside-'));
    const linkParent = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-link-'));
    const link = path.join(linkParent, 'backups');
    try {
      fs.symlinkSync(outside, link, 'junction');
      expect(() => checkedBackupDirectory('a1', link)).toThrow(/real directories/);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(linkParent, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
  it('keeps backup copies at an absolute path and refuses a relative one', () => {
    const disk = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-copies-'));
    try {
      expect(prepareBackupCopiesDirectory(disk)).toBe(path.resolve(disk));
      expect(checkedBackupCopiesDirectory(disk)).toBe(path.resolve(disk));
      expect(() => prepareBackupCopiesDirectory('archive/daily')).toThrow(/absolute/);
    } finally {
      fs.rmSync(disk, { recursive: true, force: true });
    }
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
