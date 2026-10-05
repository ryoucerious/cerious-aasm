import * as fs from 'fs';
import { readJsonOrQuarantine, writeFileAtomic, writeJsonAtomic } from './fs.utils';

const mockedFs = jest.mocked(fs);

const dir = 'C:/Users/A B/Cerious AASM';
const target = `${dir}/x.json`;
const tempPattern = /^C:\/Users\/A B\/Cerious AASM\/\.x\.json\.\d+\.[0-9a-f]+\.tmp$/;
const fd = 7;

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function tempPath(): string {
  return mockedFs.openSync.mock.calls[0][0] as string;
}

describe('fs.utils', () => {
  let wait: jest.SpyInstance;

  beforeEach(() => {
    for (const fn of [mockedFs.openSync, mockedFs.writeFileSync, mockedFs.renameSync, mockedFs.copyFileSync,
      mockedFs.unlinkSync, mockedFs.readFileSync]) {
      (fn as jest.Mock).mockReset();
    }
    mockedFs.openSync.mockReturnValue(fd);
    wait = jest.spyOn(Atomics, 'wait').mockReturnValue('timed-out');
  });

  describe('writeFileAtomic', () => {
    it('writes a temp file next to the target and renames it over the target', () => {
      writeFileAtomic(target, 'data');

      expect(tempPath()).toMatch(tempPattern);
      expect(mockedFs.openSync).toHaveBeenCalledWith(tempPath(), 'wx', undefined);
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(fd, 'data');
      expect(mockedFs.renameSync).toHaveBeenCalledWith(tempPath(), target);
      expect(mockedFs.copyFileSync).not.toHaveBeenCalled();
    });

    it('fsyncs and closes the temp file before renaming it', () => {
      writeFileAtomic(target, 'data');

      expect(mockedFs.fsyncSync).toHaveBeenCalledWith(fd);
      expect(mockedFs.closeSync).toHaveBeenCalledWith(fd);
      const rename = mockedFs.renameSync.mock.invocationCallOrder[0];
      expect(mockedFs.writeFileSync.mock.invocationCallOrder[0]).toBeLessThan(mockedFs.fsyncSync.mock.invocationCallOrder[0]);
      expect(mockedFs.fsyncSync.mock.invocationCallOrder[0]).toBeLessThan(rename);
      expect(mockedFs.closeSync.mock.invocationCallOrder[0]).toBeLessThan(rename);
    });

    it('creates the temp file with the requested mode', () => {
      writeFileAtomic(target, 'secret', { mode: 0o600 });

      expect(mockedFs.openSync).toHaveBeenCalledWith(tempPath(), 'wx', 0o600);
    });

    it('retries a rename that Windows refuses with EPERM', () => {
      mockedFs.renameSync.mockImplementationOnce(() => { throw errnoError('EPERM'); });

      writeFileAtomic(target, 'data');

      expect(mockedFs.renameSync).toHaveBeenCalledTimes(2);
      expect(wait).toHaveBeenCalledTimes(1);
      expect(wait).toHaveBeenCalledWith(expect.any(Int32Array), 0, 0, 50);
      expect(mockedFs.copyFileSync).not.toHaveBeenCalled();
      expect(mockedFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('copies over the target once the rename retries are used up', () => {
      mockedFs.renameSync.mockImplementation(() => { throw errnoError('EBUSY'); });

      writeFileAtomic(target, 'data');

      expect(mockedFs.renameSync).toHaveBeenCalledTimes(6);
      expect(wait).toHaveBeenCalledTimes(5);
      expect(mockedFs.copyFileSync).toHaveBeenCalledWith(tempPath(), target);
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(tempPath());
    });

    it('does not retry a rename error that is not transient', () => {
      mockedFs.renameSync.mockImplementation(() => { throw errnoError('EXDEV'); });

      expect(() => writeFileAtomic(target, 'data')).toThrow('EXDEV');
      expect(mockedFs.renameSync).toHaveBeenCalledTimes(1);
      expect(mockedFs.copyFileSync).not.toHaveBeenCalled();
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(tempPath());
    });

    it('removes the temp file and rethrows when the write fails', () => {
      mockedFs.writeFileSync.mockImplementation(() => { throw errnoError('ENOSPC'); });

      expect(() => writeFileAtomic(target, 'data')).toThrow('ENOSPC');
      expect(mockedFs.closeSync).toHaveBeenCalledWith(fd);
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(tempPath());
      expect(mockedFs.renameSync).not.toHaveBeenCalled();
    });

    it('removes the temp file and rethrows when the copy fallback fails', () => {
      mockedFs.renameSync.mockImplementation(() => { throw errnoError('EACCES'); });
      mockedFs.copyFileSync.mockImplementation(() => { throw errnoError('EACCES'); });

      expect(() => writeFileAtomic(target, 'data')).toThrow('EACCES');
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(tempPath());
    });
  });

  describe('writeJsonAtomic', () => {
    it('writes indented JSON atomically', () => {
      writeJsonAtomic(target, { a: 1 }, { mode: 0o600 });

      expect(mockedFs.openSync).toHaveBeenCalledWith(tempPath(), 'wx', 0o600);
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(fd, JSON.stringify({ a: 1 }, null, 2));
      expect(mockedFs.renameSync).toHaveBeenCalledWith(tempPath(), target);
    });
  });

  describe('readJsonOrQuarantine', () => {
    it('returns the parsed file', () => {
      mockedFs.readFileSync.mockReturnValue('{"a":1}');

      expect(readJsonOrQuarantine(target)).toEqual({ a: 1 });
      expect(mockedFs.readFileSync).toHaveBeenCalledWith(target, 'utf8');
    });

    it('reads a file saved with a UTF-8 byte order mark', () => {
      mockedFs.readFileSync.mockReturnValue('\uFEFF{"a":1}');

      expect(readJsonOrQuarantine(target)).toEqual({ a: 1 });
      expect(mockedFs.renameSync).not.toHaveBeenCalled();
    });

    it('returns undefined for a missing file without logging', () => {
      mockedFs.readFileSync.mockImplementation(() => { throw errnoError('ENOENT'); });

      expect(readJsonOrQuarantine(target)).toBeUndefined();
      expect(mockedFs.renameSync).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('moves a file that is not valid JSON aside and returns undefined', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      mockedFs.readFileSync.mockReturnValue('{"a":');
      const quarantined = `${target}.corrupt-1700000000000`;

      expect(readJsonOrQuarantine(target)).toBeUndefined();
      expect(mockedFs.renameSync).toHaveBeenCalledWith(target, quarantined);
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining(quarantined));
    });

    it('rethrows read errors other than a missing file', () => {
      mockedFs.readFileSync.mockImplementation(() => { throw errnoError('EACCES'); });

      expect(() => readJsonOrQuarantine(target)).toThrow('EACCES');
      expect(mockedFs.renameSync).not.toHaveBeenCalled();
    });
  });
});
