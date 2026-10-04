import { messagingService } from '../services/messaging.service';
import { serverInstanceService } from '../services/server-instance/server-instance.service';
import { getStandardEventCallbacks } from '../services/server-instance/instance-events';
import { serverLifecycleService } from '../services/server-instance/server-lifecycle.service';
import { serverMonitoringService } from '../services/server-instance/server-monitoring.service';
import { serverOperationsService } from '../services/server-instance/server-operations.service';
import { serverManagementService } from '../services/server-instance/server-management.service';
import { serverProcessService } from '../services/server-instance/server-process.service';
import { automationService } from '../services/automation/automation.service';
import { arkConfigService } from '../services/ark-config.service';
import { rconService } from '../services/rcon.service';
import { activityLogService } from '../services/activity-log.service';
import { identifySender, isDesktopWindow } from '../services/auth/permission-gate';
import * as instanceUtils from '../utils/ark/instance.utils';
import { getNormalizedInstanceState } from '../utils/ark/ark-server/ark-server-state.utils';
import { validateInstanceId } from '../utils/validation.utils';
import type { InstanceConfig } from '../types/server-instance.types';
import { onRequest } from './handler.utils';

const UP_OR_QUEUED = new Set(['running', 'starting', 'queued']);
const UP = new Set(['running', 'starting']);

onRequest('get-ini-file', payload => {
  const { instanceId, filename } = payload;
  const content = arkConfigService.readIniFile(instanceId, filename);
  return { success: true, content, instanceId, filename };
});

onRequest('save-ini-file', async payload => {
  const { instanceId, filename, content } = payload;
  arkConfigService.writeIniFile(instanceId, filename, content);

  // Every start rewrites the INI files from config.json, which would undo the edit without the merge.
  try {
    const existing = instanceUtils.getInstance(instanceId);
    if (existing) {
      const saved = await instanceUtils.saveInstance({ ...existing, ...arkConfigService.parseIniToConfig(filename, content) });
      if (saved.error) {
        console.warn(`[server-instance-handler] Could not merge ${filename} into the instance config: ${saved.error}`);
      } else {
        messagingService.sendToAll('server-instance-updated', saved);
      }
    }
  } catch {
    // Not the error itself: a JSON syntax error quotes config.json, which holds the RCON password.
    console.warn(`[server-instance-handler] Could not merge ${filename} into the instance config`);
  }

  return { success: true, instanceId, filename };
});

onRequest('start-all-instances', async (_payload, { afterReply }) => {
  const { instances } = await serverManagementService.getAllInstances();
  const eligible: InstanceConfig[] = instances.filter(
    (instance: InstanceConfig) => !UP_OR_QUEUED.has(serverProcessService.getNormalizedInstanceState(instance.id))
  );

  // Queued straight away, so get-server-instance-state says so before the staggered start reaches it.
  for (const { id } of eligible) {
    serverProcessService.setInstanceState(id, 'queued');
    messagingService.sendToAll('server-instance-state', { instanceId: id, state: 'queued' });
  }

  // Answered before the starts, which are staggered and report through the state callbacks.
  afterReply(async () => { await serverLifecycleService.startAllInstances(); });
  return { success: true, starting: eligible.map(instance => instance.id) };
});

onRequest('stop-all-instances', async (_payload, { afterReply }) => {
  const { instances } = await serverManagementService.getAllInstances();
  const eligible: InstanceConfig[] = instances.filter(
    (instance: InstanceConfig) => UP.has(serverProcessService.getNormalizedInstanceState(instance.id))
  );

  for (const { id } of eligible) {
    messagingService.sendToAll('server-instance-state', { instanceId: id, state: 'stopping' });
  }

  afterReply(async () => { await serverLifecycleService.stopAllInstances(); });
  return { success: true, stopping: eligible.map(instance => instance.id) };
});

onRequest('force-stop-server-instance', async payload => {
  const { id } = payload;
  const result = await serverInstanceService.forceStopInstance(id);
  if (result.success) {
    messagingService.sendToAll('rcon-status', { instanceId: id, connected: false });
    messagingService.sendToAll('server-instance-log', { log: '[FORCE STOP] Server force stopped', instanceId: id });
    serverMonitoringService.stopPlayerPolling(id);
    if (result.shouldNotifyAutomation) {
      automationService.setManuallyStopped(id, true);
    }
    messagingService.sendToAll('notification', { type: 'warning', message: `${result.instanceName} force stopped.` });
  }
  return result;
}, { fallbackError: 'Failed to force stop server' });

// SaveWorld, DoExit, a wait for the process, then a kill if it is still there: can take minutes.
onRequest('stop-server-instance', async payload => {
  const { id } = payload;
  if (!validateInstanceId(id)) {
    return { success: false, instanceId: id, error: 'Invalid instance ID' };
  }
  const result = await serverLifecycleService.stopServerInstance(id);
  if (result.success) {
    serverMonitoringService.stopPlayerPolling(id);
    automationService.setManuallyStopped(id, true);
    messagingService.sendToAll('rcon-status', { instanceId: id, connected: false });
  }
  return { success: result.success, instanceId: id, error: result.error };
}, { onError: (error, payload) => ({ success: false, instanceId: payload.id, error }) });

onRequest('get-server-instance-state', payload => {
  const { id } = payload;
  return { state: getNormalizedInstanceState(id), instanceId: id };
}, { onError: (_error, payload) => ({ state: 'unknown', instanceId: payload.id }) });

onRequest('get-server-instance-logs', payload => {
  const { log, instanceId } = serverMonitoringService.getInstanceLogs(payload.id, payload.maxLines);
  return { log, instanceId };
}, { onError: (_error, payload) => ({ log: '', instanceId: payload.id }) });

onRequest('connect-rcon', async (payload, { afterReply }) => {
  const { id } = payload;
  const result = await serverOperationsService.connectRcon(id);
  afterReply(() => {
    messagingService.sendToAll('rcon-status', { instanceId: id, connected: result.connected || false });
    if (result.connected) {
      serverMonitoringService.startPlayerPolling(id, (instanceId, players) => {
        messagingService.sendToAll('server-instance-players', { instanceId, players });
      });
    }
  });
  return { success: result.success, connected: result.connected, instanceId: result.instanceId, error: result.error };
}, {
  fallbackError: 'Failed to connect RCON',
  onError: (error, payload) => ({ success: false, connected: false, instanceId: payload.id, error })
});

onRequest('get-online-players', async payload => {
  const { id } = payload;
  const players = await rconService.getOnlinePlayers(id);
  return { success: true, instanceId: id, players };
}, { onError: (error, payload) => ({ success: false, instanceId: payload.id, error }) });

onRequest('disconnect-rcon', async (payload, { afterReply }) => {
  const { id } = payload;
  const result = await serverOperationsService.disconnectRcon(id);
  afterReply(() => {
    messagingService.sendToAll('rcon-status', { instanceId: id, connected: false });
    serverMonitoringService.stopPlayerPolling(id);
  });
  return { success: result.success, connected: result.connected, instanceId: result.instanceId };
}, { onError: (_error, payload) => ({ success: false, connected: false, instanceId: payload.id }) });

onRequest('get-rcon-status', payload => {
  const { success, connected, instanceId } = serverOperationsService.getRconStatus(payload.id);
  return { success, connected, instanceId };
}, { onError: (_error, payload) => ({ success: false, connected: false, instanceId: payload.id }) });

// The console shows `response` whatever happened, so failures go there too.
onRequest('rcon-command', async payload => {
  const result = await serverOperationsService.executeRconCommand(payload.id, payload.command);
  return { instanceId: result.instanceId, response: result.response || result.error || 'No response' };
}, {
  fallbackError: 'RCON command failed',
  onError: (error, payload) => ({ instanceId: payload.id, response: error })
});

onRequest('start-server-instance', async (payload, { sender }) => {
  const { id } = payload;
  messagingService.sendToAll('clear-server-instance-logs', { instanceId: id });
  const { onLog, onState } = getStandardEventCallbacks(id);
  const result = await serverInstanceService.startServerInstance(id, onLog, onState);

  if (result.started) {
    messagingService.sendToAll('notification', { type: 'info', message: `${result.instanceName} started.` });
  } else if (result.portError) {
    messagingService.sendToOriginator('notification', { type: 'error', message: result.portError }, sender);
  }
  return { success: result.started, instanceId: result.instanceId, error: result.portError };
}, {
  fallbackError: 'Failed to start server',
  onError: (error, payload) => ({ success: false, instanceId: payload.id, error })
});

onRequest('get-server-instance-players', payload => {
  const { instanceId, players } = serverMonitoringService.getPlayerCount(payload.id);
  return { instanceId, players };
}, { onError: (_error, payload) => ({ instanceId: payload.id, players: 0 }) });

onRequest('get-server-instances', async (_payload, { afterReply }) => {
  const { instances } = await serverManagementService.getAllInstances();
  afterReply(() => messagingService.sendToAll('server-instances', instances));
  return { instances };
}, { onError: () => ({ instances: [] }) });

onRequest('get-server-instance', async payload => {
  const { instance } = await serverManagementService.getInstance(payload.id);
  return { instance };
}, { onError: () => ({ instance: null }) });

onRequest('save-server-instance', async (payload, { sender, afterReply }) => {
  const { instance } = payload;
  const previous: InstanceConfig | null = instance?.id ? instanceUtils.getInstance(instance.id) : null;
  const result = await serverManagementService.saveInstance(instance);

  if (result.success && result.instance) {
    const saved: InstanceConfig = result.instance;
    afterReply(() => messagingService.sendToAll('server-instance-updated', saved));
    afterReply(() => serverInstanceService.broadcastInstances());
    afterReply(() => messagingService.sendToAllOthers('notification', { type: 'info', message: describeSave(previous, saved) }, sender));
  }
  return { success: result.success, instance: result.instance, error: result.error };
}, { fallbackError: 'Failed to save server instance' });

onRequest('delete-server-instance', async (payload, { sender, afterReply }) => {
  const { id } = payload;
  const result = await serverInstanceService.deleteInstance(id);

  if (result.success) {
    afterReply(() => serverInstanceService.broadcastInstances());
    afterReply(() => activityLogService.record('info', 'Server deleted', id, identifySender(sender).user?.username || null));
    afterReply(() => messagingService.sendToAllOthers('notification', { type: 'info', message: 'Server deleted.' }, sender));
  }
  return { success: result.success, id: result.id };
}, { onError: (_error, payload) => ({ success: false, id: payload.id }) });

// `fileName` is still sent by clients; it is never used, so it cannot end up in a path.
onRequest('import-server-from-backup', async (payload, { sender, afterReply }) => {
  const { serverName, backupFilePath, fileData } = payload;
  const result = await serverInstanceService.importServerFromBackup(
    serverName,
    { filePath: backupFilePath, fileData },
    isDesktopWindow(sender)
  );
  if (result.success) {
    afterReply(() => serverInstanceService.broadcastInstances());
  }
  return { success: result.success, instance: result.instance, message: result.message, error: result.error };
}, { fallbackError: 'Failed to import server from backup' });

onRequest('reorder-server-instances', async payload => {
  const { orderedIds } = payload;
  if (!Array.isArray(orderedIds)) {
    return { success: false, error: 'orderedIds must be an array' };
  }

  const { instances } = await serverManagementService.getAllInstances();
  for (const [position, id] of orderedIds.entries()) {
    const instance = instances.find((candidate: InstanceConfig) => candidate.id === id);
    if (instance) {
      instance.sortOrder = position;
      await serverManagementService.saveInstance(instance);
    }
  }

  await serverInstanceService.broadcastInstances();
  return { success: true };
}, { fallbackError: 'Failed to reorder server instances' });

function describeSave(previous: InstanceConfig | null, saved: InstanceConfig): string {
  if (previous && previous.name !== saved.name) {
    return `Server renamed from "${previous.name}" to "${saved.name}".`;
  }
  if (previous) {
    return `Server "${saved.name || saved.id}" updated.`;
  }
  return `Server "${saved.name || saved.id || 'Unknown'}" added.`;
}
