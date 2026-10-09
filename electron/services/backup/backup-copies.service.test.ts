jest.unmock('fs');
jest.unmock('path');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BackupCopiesService } from './backup-copies.service';

describe('BackupCopiesService', () => {
  let root: string;
  let copies: BackupCopiesService;
  const meta = { serverId: 's1', serverName: 'Island', fileName: 'backup_manual_1.zip', size: 5, fromNodeId: 'n1', fromNodeName: 'PC 1' };
  const fetchBytes = (bytes: string) => async (dest: string) => { fs.writeFileSync(dest, bytes); return true; };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-copies-'));
    copies = new BackupCopiesService(() => root, () => 1_000);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  describe('on the machine keeping a copy', () => {
    it('keeps the copy it fetched, and says what it is and where it came from', async () => {
      await expect(copies.hold(meta, fetchBytes('12345'))).resolves.toEqual({ success: true });

      expect(fs.readFileSync(copies.heldPath('s1')!, 'utf8')).toBe('12345');
      expect(copies.list()).toEqual([{ ...meta, copiedAt: 1_000 }]);
    });

    // Only the latest: each new copy replaces the one before.
    it('keeps only the latest copy of each server', async () => {
      await copies.hold(meta, fetchBytes('12345'));
      await copies.hold({ ...meta, fileName: 'backup_manual_2.zip' }, fetchBytes('abcde'));

      expect(fs.readdirSync(path.join(root, 's1')).sort()).toEqual(['backup_manual_2.zip', 'copy.json']);
      expect(copies.list()).toEqual([expect.objectContaining({ fileName: 'backup_manual_2.zip' })]);
    });

    it('keeps the copy it had when a new one does not arrive whole', async () => {
      await copies.hold(meta, fetchBytes('12345'));

      const result = await copies.hold({ ...meta, fileName: 'backup_manual_2.zip' }, fetchBytes('abc'));

      expect(result).toEqual({ success: false, error: 'The copy of backup_manual_2.zip arrived incomplete.' });
      expect(copies.list()).toEqual([expect.objectContaining({ fileName: 'backup_manual_1.zip' })]);
      expect(fs.readdirSync(path.join(root, 's1')).sort()).toEqual(['backup_manual_1.zip', 'copy.json']);
    });

    it('keeps the copy it had when the new one cannot be fetched', async () => {
      await copies.hold(meta, fetchBytes('12345'));

      const result = await copies.hold({ ...meta, fileName: 'backup_manual_2.zip' }, async () => false);

      expect(result).toEqual({ success: false, error: 'Could not fetch backup_manual_2.zip from PC 1.' });
      expect(copies.heldPath('s1')).toBe(path.join(root, 's1', 'backup_manual_1.zip'));
    });

    it('refuses a file name that would leave its folder', async () => {
      const result = await copies.hold({ ...meta, fileName: '../escape.zip' }, fetchBytes('12345'));

      expect(result.success).toBe(false);
      expect(fs.existsSync(path.join(root, 'escape.zip'))).toBe(false);
    });

    it('drops a server\'s copy', async () => {
      await copies.hold(meta, fetchBytes('12345'));

      copies.drop('s1');

      expect(copies.list()).toEqual([]);
      expect(copies.heldPath('s1')).toBeNull();
    });
  });

  describe('on the server\'s machine', () => {
    it('remembers where the latest copy went', () => {
      expect(copies.sent('s1')).toBeNull();

      copies.recordSent('s1', { nodeId: 'n2', nodeName: 'asa-1', fileName: 'backup_manual_1.zip', size: 5 });

      expect(copies.sent('s1')).toEqual({ nodeId: 'n2', nodeName: 'asa-1', fileName: 'backup_manual_1.zip', size: 5, copiedAt: 1_000 });
    });
  });
});
