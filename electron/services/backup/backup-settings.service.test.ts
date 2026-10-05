import * as fs from 'fs';
import * as fsUtils from '../../utils/fs.utils';
import { BackupSettings } from '../../types/backup.types';
import { BackupSettingsService } from './backup-settings.service';

jest.mock('../../utils/platform.utils', () => ({
  getDefaultInstallDir: jest.fn(() => '/install')
}));

const settings: BackupSettings = {
  instanceId: 'abc',
  enabled: true,
  frequency: 'daily',
  time: '03:00',
  maxBackupsToKeep: 5
};

describe('BackupSettingsService', () => {
  const readFile = fs.promises.readFile as jest.Mock;
  let writeJsonAtomic: jest.SpyInstance;

  beforeEach(() => {
    (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);
    writeJsonAtomic = jest.spyOn(fsUtils, 'writeJsonAtomic').mockImplementation(() => {});
  });

  describe('getBackupSettingsInternal', () => {
    it('reads the settings file in the server directory', async () => {
      readFile.mockResolvedValue(JSON.stringify(settings));

      await expect(new BackupSettingsService().getBackupSettingsInternal('/servers/abc')).resolves.toEqual(settings);
      expect(readFile).toHaveBeenCalledWith('/servers/abc/backup-settings.json', 'utf8');
    });

    it('reads a settings file saved with a byte order mark', async () => {
      readFile.mockResolvedValue(`\uFEFF${JSON.stringify(settings)}`);

      await expect(new BackupSettingsService().getBackupSettingsInternal('/servers/abc')).resolves.toEqual(settings);
      expect(console.error).not.toHaveBeenCalled();
    });

    it('has no settings for an instance that never saved any', async () => {
      readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      await expect(new BackupSettingsService().getBackupSettingsInternal('/servers/abc')).resolves.toBeNull();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('logs a settings file it cannot parse, without the parser message', async () => {
      // V8 quotes the start of the text it could not parse.
      readFile.mockResolvedValue('secret-webhook-url');

      await expect(new BackupSettingsService().getBackupSettingsInternal('/servers/abc')).resolves.toBeNull();
      const logged = jest.mocked(console.error).mock.calls.flat()
        .map(arg => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(' ');
      expect(logged).toContain('[backup-settings]');
      expect(logged).not.toContain('secret');
    });
  });

  describe('saveBackupSettingsInternal', () => {
    it('writes the settings file atomically in the server directory', async () => {
      await new BackupSettingsService().saveBackupSettingsInternal(settings, '/servers/abc');

      expect(writeJsonAtomic).toHaveBeenCalledWith('/servers/abc/backup-settings.json', settings);
    });

    it('leaves the backups directory to the first backup', async () => {
      // The settings live in the server directory; an empty backups folder would only be clutter.
      await new BackupSettingsService().saveBackupSettingsInternal(settings, '/servers/abc');

      expect(fs.promises.mkdir).not.toHaveBeenCalled();
    });

    it('rethrows a failed write', async () => {
      writeJsonAtomic.mockImplementation(() => { throw new Error('disk full'); });

      await expect(new BackupSettingsService().saveBackupSettingsInternal(settings, '/servers/abc'))
        .rejects.toThrow('disk full');
    });
  });
});
