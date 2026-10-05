import { BrowserWindow, dialog } from 'electron';
import { directoryService } from '../services/directory.service';
import { isDesktopWindow } from '../services/auth/permission-gate';
import { onRequest } from './handler.utils';

// The dialog can only open over the desktop window; a web client's sender is not a WebContents.
onRequest('select-directory', async (payload, { sender }) => {
  const win = isDesktopWindow(sender) ? BrowserWindow.fromWebContents(sender) : null;
  if (!win) {
    return { success: false, error: 'Could not determine window' };
  }
  const result = await dialog.showOpenDialog(win, {
    title: payload.title || 'Select Directory',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  return { path: result.filePaths[0] };
}, { onError: error => ({ error }) });

onRequest('open-config-directory', async () => {
  const result = await directoryService.openConfigDirectory();
  return result.success ? { configDir: result.configDir } : { success: false, error: result.error };
});

// The check stats the path and writes a file there, so a web client could map the host's disks.
onRequest('test-directory-access', async (payload, { sender }) => {
  if (!isDesktopWindow(sender)) {
    return { success: false, accessible: false, error: 'Directory checks are only available in the desktop app' };
  }
  const { accessible, error } = await directoryService.testDirectoryAccess(payload.directoryPath);
  return { accessible, error };
}, { onError: error => ({ accessible: false, error }) });

onRequest('open-directory', async payload => {
  const result = await directoryService.openInstanceDirectory(payload.id);
  return result.success ? { id: result.instanceId } : { success: false, error: result.error };
});
