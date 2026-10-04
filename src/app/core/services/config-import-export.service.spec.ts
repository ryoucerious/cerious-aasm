import { ConfigImportExportService, ExportResult, ImportResult } from './config-import-export.service';
import { FILE_TRANSFER_TIMEOUT_MS, MessagingService } from './messaging/messaging.service';
import { of, throwError } from 'rxjs';

describe('ConfigImportExportService', () => {
  let service: ConfigImportExportService;
  let messaging: jasmine.SpyObj<MessagingService>;

  beforeEach(() => {
    messaging = jasmine.createSpyObj('MessagingService', ['sendMessage']);
    service = new ConfigImportExportService(messaging);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('exportAsZip', () => {
    it('should send export-server-config message with server id', (done) => {
      const result: ExportResult = { success: true, base64: 'abc123', suggestedFileName: 'config.zip' };
      messaging.sendMessage.and.returnValue(of(result));

      service.exportAsZip('server-1').subscribe((res) => {
        expect(res).toEqual(result);
        expect(messaging.sendMessage).toHaveBeenCalledWith('export-server-config', { id: 'server-1' }, { timeoutMs: FILE_TRANSFER_TIMEOUT_MS });
        done();
      });
    });

    it('should propagate errors from messaging', (done) => {
      messaging.sendMessage.and.returnValue(throwError(() => 'export failed'));

      service.exportAsZip('server-1').subscribe({
        error: (err: any) => {
          expect(err).toBe('export failed');
          done();
        }
      });
    });
  });

  describe('importFromIniContent', () => {
    it('should send import-server-config message with content and fileName', (done) => {
      const result: ImportResult = { success: true, merged: true, warnings: [] };
      messaging.sendMessage.and.returnValue(of(result));

      service.importFromIniContent('ini-content', 'GameUserSettings.ini', 'server-2').subscribe((res) => {
        expect(res).toEqual(result);
        expect(messaging.sendMessage).toHaveBeenCalledWith('import-server-config', {
          targetId: 'server-2',
          content: 'ini-content',
          fileName: 'GameUserSettings.ini'
        });
        done();
      });
    });

    it('should send undefined targetId when not provided', (done) => {
      const result: ImportResult = { success: true };
      messaging.sendMessage.and.returnValue(of(result));

      service.importFromIniContent('content', 'Game.ini').subscribe((res) => {
        expect(res).toEqual(result);
        expect(messaging.sendMessage).toHaveBeenCalledWith('import-server-config', {
          targetId: undefined,
          content: 'content',
          fileName: 'Game.ini'
        });
        done();
      });
    });

    it('should propagate errors from messaging', (done) => {
      messaging.sendMessage.and.returnValue(throwError(() => 'import failed'));

      service.importFromIniContent('content', 'file.ini').subscribe({
        error: (err: any) => {
          expect(err).toBe('import failed');
          done();
        }
      });
    });
  });
});
