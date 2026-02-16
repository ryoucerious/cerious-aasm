import { messagingService } from '../services/messaging.service';
import { configImportExportService } from '../services/config-import-export.service';
import * as instanceUtils from '../utils/ark/instance.utils';
import { serverManagementService } from '../services/server-instance/server-management.service';

/**
 * Handle export-server-config: Export a server's configuration as a ZIP containing INI files.
 * 
 * @param payload.id - Server instance ID to export
 */
messagingService.on('export-server-config', async (payload, sender) => {
  const { id, requestId } = payload || {};

  try {
    if (!id) {
      throw new Error('Server instance ID is required');
    }

    const config = instanceUtils.getInstance(id);
    if (!config) {
      throw new Error(`Server instance not found: ${id}`);
    }

    const zipResult = configImportExportService.exportConfigAsZip(config);
    if (!zipResult.success) {
      throw new Error(zipResult.error || 'Failed to create ZIP');
    }

    const suggestedFileName = `${config.name || 'server'}-config.zip`;

    messagingService.sendToOriginator('export-server-config', {
      success: true,
      base64: zipResult.base64,
      suggestedFileName,
      requestId
    }, sender);
  } catch (error) {
    console.error('[config-import-export-handler] Export failed:', error);
    messagingService.sendToOriginator('export-server-config', {
      success: false,
      error: (error as Error)?.message || 'Failed to export config',
      requestId
    }, sender);
  }
});

/**
 * Handle import-server-config: Import server configuration from an INI file.
 * 
 * @param payload.targetId - Optional: existing server instance ID to merge settings into
 * @param payload.content - Raw INI content
 * @param payload.fileName - File name (e.g. GameUserSettings.ini or Game.ini)
 */
messagingService.on('import-server-config', async (payload, sender) => {
  const { targetId, content, fileName, requestId } = payload || {};

  try {
    if (!content) {
      throw new Error('No INI content provided');
    }

    const files: Array<{ fileName: string; content: string }> = [];
    files.push({ fileName: fileName || 'GameUserSettings.ini', content });

    const result = configImportExportService.importFromIni(files);
    if (!result.success) throw new Error(result.error);
    const importedConfig = result.config;
    const warnings = result.warnings || [];

    // If a target server ID is provided, merge into that server's config
    if (targetId) {
      const existing = instanceUtils.getInstance(targetId);
      if (!existing) {
        throw new Error(`Target server not found: ${targetId}`);
      }

      // Merge imported config over existing, preserving identity fields
      const merged = {
        ...existing,
        ...importedConfig,
        id: existing.id,
        name: existing.name,
      };

      const saveResult = await serverManagementService.saveInstance(merged);
      if (!saveResult.success) {
        throw new Error(saveResult.error || 'Failed to save merged config');
      }

      const allInstances = await serverManagementService.getAllInstances();
      messagingService.sendToAll('server-instances', allInstances.instances);
      messagingService.sendToAll('server-instance-updated', saveResult.instance);

      messagingService.sendToOriginator('import-server-config', {
        success: true,
        config: saveResult.instance,
        merged: true,
        warnings,
        requestId
      }, sender);
    } else {
      messagingService.sendToOriginator('import-server-config', {
        success: true,
        config: importedConfig,
        merged: false,
        warnings,
        requestId
      }, sender);
    }

    messagingService.sendToAll('notification', {
      type: 'success',
      message: `Server configuration imported successfully.${warnings.length > 0 ? ` (${warnings.length} warnings)` : ''}`
    });

  } catch (error) {
    console.error('[config-import-export-handler] Import failed:', error);
    messagingService.sendToOriginator('import-server-config', {
      success: false,
      error: (error as Error)?.message || 'Failed to import config',
      requestId
    }, sender);
  }
});
