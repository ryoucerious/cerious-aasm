import { ConfigImportExportService, ExportResult, ImportResult } from './config-import-export.service';
import { MessagingService } from './messaging/messaging.service';
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
        expect(messaging.sendMessage).toHaveBeenCalledWith('export-server-config', { id: 'server-1' });
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

    it('should complete after first emission (take 1)', () => {
      const result: ExportResult = { success: true };
      messaging.sendMessage.and.returnValue(of(result));
      let completed = false;

      service.exportAsZip('server-1').subscribe({
        complete: () => { completed = true; }
      });

      expect(completed).toBeTrue();
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

  describe('downloadBase64AsFile', () => {
    it('should create a download link and trigger click', () => {
      const mockAnchor = jasmine.createSpyObj('HTMLAnchorElement', ['click']);
      mockAnchor.href = '';
      mockAnchor.download = '';
      spyOn(document, 'createElement').and.returnValue(mockAnchor);
      spyOn(document.body, 'appendChild');
      spyOn(document.body, 'removeChild');
      spyOn(URL, 'createObjectURL').and.returnValue('blob:mock-url');
      spyOn(URL, 'revokeObjectURL');

      // btoa('hello') === 'aGVsbG8='
      service.downloadBase64AsFile('aGVsbG8=', 'test.zip');

      expect(document.createElement).toHaveBeenCalledWith('a');
      expect(mockAnchor.download).toBe('test.zip');
      expect(mockAnchor.href).toBe('blob:mock-url');
      expect(document.body.appendChild).toHaveBeenCalledWith(mockAnchor);
      expect(mockAnchor.click).toHaveBeenCalled();
      expect(document.body.removeChild).toHaveBeenCalledWith(mockAnchor);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('should use provided mimeType for the Blob', () => {
      const mockAnchor = jasmine.createSpyObj('HTMLAnchorElement', ['click']);
      mockAnchor.href = '';
      mockAnchor.download = '';
      spyOn(document, 'createElement').and.returnValue(mockAnchor);
      spyOn(document.body, 'appendChild');
      spyOn(document.body, 'removeChild');

      let capturedBlob: Blob | undefined;
      spyOn(URL, 'createObjectURL').and.callFake((blob: Blob) => {
        capturedBlob = blob;
        return 'blob:mock-url';
      });
      spyOn(URL, 'revokeObjectURL');

      service.downloadBase64AsFile('aGVsbG8=', 'test.ini', 'text/plain');

      expect(capturedBlob).toBeDefined();
      expect(capturedBlob!.type).toBe('text/plain');
    });

    it('should default mimeType to application/zip', () => {
      const mockAnchor = jasmine.createSpyObj('HTMLAnchorElement', ['click']);
      mockAnchor.href = '';
      mockAnchor.download = '';
      spyOn(document, 'createElement').and.returnValue(mockAnchor);
      spyOn(document.body, 'appendChild');
      spyOn(document.body, 'removeChild');

      let capturedBlob: Blob | undefined;
      spyOn(URL, 'createObjectURL').and.callFake((blob: Blob) => {
        capturedBlob = blob;
        return 'blob:mock-url';
      });
      spyOn(URL, 'revokeObjectURL');

      service.downloadBase64AsFile('aGVsbG8=', 'test.zip');

      expect(capturedBlob!.type).toBe('application/zip');
    });
  });
});
