import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { FILE_TRANSFER_TIMEOUT_MS, MessagingService } from './messaging/messaging.service';

export interface ExportResult {
  success: boolean;
  base64?: string;
  suggestedFileName?: string;
  error?: string;
}

export interface ImportResult {
  success: boolean;
  config?: any;
  merged?: boolean;
  warnings?: string[];
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ConfigImportExportService {

  constructor(private messaging: MessagingService) {}

  /** A ZIP of the server's INI files, base64-encoded. */
  exportAsZip(serverId: string): Observable<ExportResult> {
    return this.messaging.sendMessage('export-server-config', {
      id: serverId
    }, { timeoutMs: FILE_TRANSFER_TIMEOUT_MS });
  }

  /** Merges the settings in an INI file's text into an existing server. */
  importFromIniContent(content: string, fileName: string, targetServerId?: string): Observable<ImportResult> {
    return this.messaging.sendMessage('import-server-config', {
      targetId: targetServerId,
      content,
      fileName
    });
  }
}
