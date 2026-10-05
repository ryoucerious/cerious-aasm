import { messagingService } from '../services/messaging.service';
import { configImportExportService } from '../services/config-import-export.service';
import { serverInstanceService } from '../services/server-instance/server-instance.service';
import { serverManagementService } from '../services/server-instance/server-management.service';
import * as instanceUtils from '../utils/ark/instance.utils';
import { validateInstanceId } from '../utils/validation.utils';
import { onRequest } from './handler.utils';

onRequest('export-server-config', payload => {
  const { id } = payload;
  if (!id) {
    return { success: false, error: 'Server instance ID is required' };
  }
  if (!validateInstanceId(id)) {
    return { success: false, error: 'Invalid instance ID' };
  }
  const config = instanceUtils.getInstance(id);
  if (!config) {
    return { success: false, error: `Server instance not found: ${id}` };
  }
  const zip = configImportExportService.exportConfigAsZip(config);
  if (!zip.success) {
    return { success: false, error: zip.error || 'Failed to create ZIP' };
  }
  return { success: true, base64: zip.base64, suggestedFileName: `${config.name || 'server'}-config.zip` };
}, { fallbackError: 'Failed to export config' });

// Without a target nothing is saved: the parsed settings are only returned.
onRequest('import-server-config', async (payload, { afterReply }) => {
  const { targetId, content, fileName } = payload;
  if (!content) {
    return { success: false, error: 'No INI content provided' };
  }
  if (targetId && !validateInstanceId(targetId)) {
    return { success: false, error: 'Invalid instance ID' };
  }

  const imported = configImportExportService.importFromIni([{ fileName: fileName || 'GameUserSettings.ini', content }]);
  if (!imported.success) {
    return { success: false, error: imported.error || 'Failed to import config' };
  }
  const warnings = imported.warnings || [];

  let reply: Record<string, unknown> = { success: true, config: imported.config, merged: false, warnings };
  if (targetId) {
    const existing = instanceUtils.getInstance(targetId);
    if (!existing) {
      return { success: false, error: `Target server not found: ${targetId}` };
    }
    // The file's settings replace the target's, but the target keeps its identity.
    const saved = await serverManagementService.saveInstance({ ...existing, ...imported.config, id: existing.id, name: existing.name });
    if (!saved.success) {
      return { success: false, error: saved.error || 'Failed to save merged config' };
    }
    await serverInstanceService.broadcastInstances();
    messagingService.sendToAll('server-instance-updated', saved.instance);
    reply = { success: true, config: saved.instance, merged: true, warnings };
  }

  const suffix = warnings.length > 0 ? ` (${warnings.length} warnings)` : '';
  afterReply(() => messagingService.sendToAll('notification', {
    type: 'success',
    message: `Server configuration imported successfully.${suffix}`,
    // Only an import into a server is about a server; a parse-only import is for everyone.
    ...(typeof targetId === 'string' && targetId ? { instanceId: targetId } : {})
  }));
  return reply;
}, { fallbackError: 'Failed to import config' });
