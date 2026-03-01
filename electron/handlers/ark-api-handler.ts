import { messagingService } from '../services/messaging.service';
import { arkApiPluginService } from '../services/ark-api-plugin.service';

/**
 * List installed ArkApi plugins for a server instance.
 * Payload: { instanceId, requestId }
 */
messagingService.on('list-ark-api-plugins', async (payload: any, sender: any) => {
  const { instanceId, requestId } = payload || {};
  try {
    const plugins = arkApiPluginService.listPlugins(instanceId);
    messagingService.sendToOriginator('list-ark-api-plugins', { success: true, plugins, requestId }, sender);
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('[ark-api-handler] list-ark-api-plugins error:', errorMsg);
    messagingService.sendToOriginator('list-ark-api-plugins', { success: false, error: errorMsg, requestId }, sender);
  }
});

/**
 * Remove (uninstall) an ArkApi plugin.
 * Payload: { instanceId, folderName, requestId }
 */
messagingService.on('remove-ark-api-plugin', async (payload: any, sender: any) => {
  const { instanceId, folderName, requestId } = payload || {};
  try {
    arkApiPluginService.removePlugin(instanceId, folderName);
    messagingService.sendToOriginator('remove-ark-api-plugin', { success: true, folderName, requestId }, sender);
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('[ark-api-handler] remove-ark-api-plugin error:', errorMsg);
    messagingService.sendToOriginator('remove-ark-api-plugin', { success: false, error: errorMsg, requestId }, sender);
  }
});

/**
 * Fetch the latest AsaApi release metadata from GitHub.
 * Payload: { requestId }
 */
messagingService.on('get-asaapi-latest', async (payload: any, sender: any) => {
  const { requestId } = payload || {};
  try {
    const release = await arkApiPluginService.getLatestAsaApiRelease();
    messagingService.sendToOriginator('get-asaapi-latest', { success: true, ...release, requestId }, sender);
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('[ark-api-handler] get-asaapi-latest error:', errorMsg);
    messagingService.sendToOriginator('get-asaapi-latest', { success: false, error: errorMsg, requestId }, sender);
  }
});

/**
 * Download and install AsaApi for a server instance.
 * Payload: { instanceId, downloadUrl, requestId }
 */
messagingService.on('download-asaapi', async (payload: any, sender: any) => {
  const { instanceId, downloadUrl, requestId } = payload || {};
  try {
    messagingService.sendToOriginator('download-asaapi-progress', { status: 'downloading', requestId }, sender);
    await arkApiPluginService.downloadAsaApi(instanceId, downloadUrl);
    messagingService.sendToOriginator('download-asaapi', { success: true, requestId }, sender);
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('[ark-api-handler] download-asaapi error:', errorMsg);
    messagingService.sendToOriginator('download-asaapi', { success: false, error: errorMsg, requestId }, sender);
  }
});

/**
 * Install a plugin from a local ZIP file path (Electron exposes file.path on File objects).
 * Payload: { instanceId, zipPath, requestId }
 */
messagingService.on('install-plugin-from-zip', async (payload: any, sender: any) => {
  const { instanceId, zipPath, requestId } = payload || {};
  try {
    arkApiPluginService.installPluginFromZipPath(instanceId, zipPath);
    messagingService.sendToOriginator('install-plugin-from-zip', { success: true, requestId }, sender);
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('[ark-api-handler] install-plugin-from-zip error:', errorMsg);
    messagingService.sendToOriginator('install-plugin-from-zip', { success: false, error: errorMsg, requestId }, sender);
  }
});

/**
 * Install a plugin by downloading a ZIP from a URL.
 * Payload: { instanceId, url, requestId }
 */
messagingService.on('install-plugin-from-url', async (payload: any, sender: any) => {
  const { instanceId, url, requestId } = payload || {};
  try {
    await arkApiPluginService.installPluginFromUrl(instanceId, url);
    messagingService.sendToOriginator('install-plugin-from-url', { success: true, requestId }, sender);
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('[ark-api-handler] install-plugin-from-url error:', errorMsg);
    messagingService.sendToOriginator('install-plugin-from-url', { success: false, error: errorMsg, requestId }, sender);
  }
});
