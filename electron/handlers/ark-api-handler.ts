import { messagingService } from '../services/messaging.service';
import { arkApiPluginService } from '../services/ark-api-plugin.service';
import { isDesktopWindow } from '../services/auth/permission-gate';
import { isAsaApiLoaderInstalled } from '../utils/ark/ark-server/ark-server-paths.utils';
import { validateInstanceId } from '../utils/validation.utils';
import { onRequest } from './handler.utils';

const INVALID_ID = { success: false, error: 'Invalid instance ID' };

onRequest('get-asaapi-status', payload => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const installed = isAsaApiLoaderInstalled(instanceId);
  return { success: true, installed, loaderExe: installed ? 'AsaApiLoader.exe' : null };
});

onRequest('list-ark-api-plugins', payload => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  return { success: true, plugins: arkApiPluginService.listPlugins(instanceId) };
});

onRequest('remove-ark-api-plugin', payload => {
  const { instanceId, folderName } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  arkApiPluginService.removePlugin(instanceId, folderName);
  return { success: true, folderName };
});

onRequest('get-asaapi-latest', async () => {
  const release = await arkApiPluginService.getLatestAsaApiRelease();
  return { success: true, ...release };
});

onRequest('download-asaapi', async (payload, { sender, requestId }) => {
  const { instanceId, downloadUrl } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  messagingService.sendToOriginator('download-asaapi-progress', { status: 'downloading', requestId }, sender);
  await arkApiPluginService.downloadAsaApi(instanceId, downloadUrl);
  return { success: true };
});

// The desktop hands over the dropped file's path (Electron's File.path). A web client could name
// any ZIP on the host, so it has to use a download URL.
onRequest('install-plugin-from-zip', (payload, { sender }) => {
  const { instanceId, zipPath } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  if (!isDesktopWindow(sender)) {
    return { success: false, error: 'Only the desktop app can install a plugin from a file path. Use a download URL instead.' };
  }
  arkApiPluginService.installPluginFromZipPath(instanceId, zipPath);
  return { success: true };
});

onRequest('install-plugin-from-url', async payload => {
  const { instanceId, url } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  await arkApiPluginService.installPluginFromUrl(instanceId, url);
  return { success: true };
});
