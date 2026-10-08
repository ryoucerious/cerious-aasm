import { messagingService } from '../services/messaging.service';
import { arkApiPluginService } from '../services/ark-api-plugin.service';
import { identifySender, isDesktopWindow } from '../services/auth/permission-gate';
import { ArkApiAction, isReadOnlyArkApiAction, runArkApiAction } from '../services/ark-api-actions';
import { meshService } from '../services/mesh/mesh-service';
import type { MessageSender } from '../types/messaging.types';
import { validateInstanceId } from '../utils/validation.utils';
import { onRequest } from './handler.utils';

const INVALID_ID = { success: false, error: 'Invalid instance ID' };

/**
 * The action on the machine that runs the server. In a mesh that may be another machine: a read
 * goes there as a query, a change as a command the mesh logs. Null for a server this machine runs.
 */
async function onServersMachine(
  instanceId: string,
  action: ArkApiAction,
  args: Record<string, unknown>,
  sender: MessageSender
): Promise<Record<string, unknown> | null> {
  if (isReadOnlyArkApiAction(action)) {
    return meshService.queryRemote<Record<string, unknown>>(instanceId, 'ark-api', { ...args, action });
  }
  const actor = identifySender(sender).user?.username || 'desktop';
  const result = await meshService.forwardIfRemote('ark-api', instanceId, actor, { ...args, action });
  if (!result) return null;
  return result.success ? { ...((result.detail as Record<string, unknown>) || {}), success: true } : { success: false, error: result.error };
}

async function arkApi(instanceId: string, action: ArkApiAction, args: Record<string, unknown>, sender: MessageSender): Promise<Record<string, unknown>> {
  return (await onServersMachine(instanceId, action, args, sender)) ?? runArkApiAction(instanceId, action, args);
}

onRequest('get-asaapi-status', (payload, { sender }) => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  return arkApi(instanceId, 'status', {}, sender);
});

onRequest('list-ark-api-plugins', (payload, { sender }) => {
  const { instanceId } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  return arkApi(instanceId, 'list', {}, sender);
});

onRequest('remove-ark-api-plugin', (payload, { sender }) => {
  const { instanceId, folderName } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  return arkApi(instanceId, 'remove', { folderName }, sender);
});

onRequest('get-asaapi-latest', async () => {
  const release = await arkApiPluginService.getLatestAsaApiRelease();
  return { success: true, ...release };
});

onRequest('download-asaapi', async (payload, { sender, requestId }) => {
  const { instanceId, downloadUrl } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  const elsewhere = await onServersMachine(instanceId, 'download-asaapi', { downloadUrl }, sender);
  if (elsewhere) return elsewhere;
  messagingService.sendToOriginator('download-asaapi-progress', { status: 'downloading', requestId }, sender);
  return runArkApiAction(instanceId, 'download-asaapi', { downloadUrl });
});

// The desktop names the chosen file (Electron's File.path), which it reads and sends on: the
// server's machine may be another one, which cannot open a path here. A web client could name any
// ZIP on the host that way, so it sends the ZIP itself, which names nothing on the host.
onRequest('install-plugin-from-zip', async (payload, { sender }) => {
  const { instanceId, zipPath, zipData } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  if (typeof zipData === 'string') return arkApi(instanceId, 'install-zip', { zipData }, sender);
  if (!isDesktopWindow(sender)) {
    return { success: false, error: 'Only the desktop app can install a plugin from a file path. Use a download URL instead.' };
  }
  return arkApi(instanceId, 'install-zip', { zipData: arkApiPluginService.readZipAsBase64(String(zipPath ?? '')) }, sender);
});

onRequest('install-plugin-from-url', (payload, { sender }) => {
  const { instanceId, url } = payload;
  if (!validateInstanceId(instanceId)) return INVALID_ID;
  return arkApi(instanceId, 'install-url', { url }, sender);
});
