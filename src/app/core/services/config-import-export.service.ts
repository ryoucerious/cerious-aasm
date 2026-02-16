import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { MessagingService } from './messaging/messaging.service';

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

  /**
   * Export a server's configuration as a ZIP file containing all INI files.
   */
  exportAsZip(serverId: string): Observable<ExportResult> {
    return this.messaging.sendMessage('export-server-config', {
      id: serverId
    }).pipe(take(1));
  }

  /**
   * Import a config from an INI file's raw content and merge into an existing server.
   */
  importFromIniContent(content: string, fileName: string, targetServerId?: string): Observable<ImportResult> {
    return this.messaging.sendMessage('import-server-config', {
      targetId: targetServerId,
      content,
      fileName
    }).pipe(take(1));
  }

  /**
   * Trigger a binary file download in the browser from a base64-encoded string.
   */
  downloadBase64AsFile(base64: string, fileName: string, mimeType: string = 'application/zip'): void {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
