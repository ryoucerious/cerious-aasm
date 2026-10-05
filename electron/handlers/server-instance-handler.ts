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
import { identifySender, isDesktopWindow, SenderIdentity } from '../services/auth/permission-gate';
import { filterInstancesForUser } from '../services/auth/pool-access';
import { applyServerOwnership, assigneeRefusal, canAssignFor, operatorRefusal } from '../services/auth/server-ownership';
import { userDatabaseService } from '../services/auth/user-database.service';
import { PERMISSIONS } from '../types/auth.types';
import type { MessageSender } from '../types/messaging.types';
import * as instanceUtils from '../utils/ark/instance.utils';
import { validateInstanceId } from '../utils/validation.utils';
import type { InstanceConfig } from '../types/server-instance.types';
import { localRuntime } from '../services/runtime/local-runtime';
import { meshService } from '../services/mesh/mesh-service';
import { onRequest } from './handler.utils';

const UP_OR_QUEUED = new Set(['running', 'starting', 'queued']);
const UP = new Set(['running', 'starting']);

const lookupUser = (id: string) => userDatabaseService.getUser(id);

/** The instances this sender may see: everything for an admin, their pool for anyone else. */
function visibleTo(identity: SenderIdentity, instances: InstanceConfig[]): InstanceConfig[] {
  return identity.isAdmin ? instances : filterInstancesForUser(identity.user, instances);
}

/** The ids a Start All or Stop All from this sender covers; undefined means every server. */
function scopeIds(identity: SenderIdentity, instances: InstanceConfig[]): string[] | undefined {
  return identity.isAdmin ? undefined : visibleTo(identity, instances).map(instance => instance.id);
}

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

onRequest('start-all-instances', async (_payload, { sender, afterReply }) => {
  const { instances } = await serverManagementService.getAllInstances();
  const identity = identifySender(sender);
  const onlyIds = scopeIds(identity, instances);
  const eligible: InstanceConfig[] = visibleTo(identity, instances).filter(
    (instance: InstanceConfig) => !UP_OR_QUEUED.has(serverProcessService.getNormalizedInstanceState(instance.id))
  );

  // Queued straight away, so get-server-instance-state says so before the staggered start reaches it.
  for (const { id } of eligible) {
    serverProcessService.setInstanceState(id, 'queued');
    messagingService.sendToAll('server-instance-state', { instanceId: id, state: 'queued' });
  }

  // Answered before the starts, which are staggered and report through the state callbacks.
  afterReply(async () => { await serverLifecycleService.startAllInstances(undefined, onlyIds); });
  return { success: true, starting: eligible.map(instance => instance.id) };
});

onRequest('stop-all-instances', async (_payload, { sender, afterReply }) => {
  const { instances } = await serverManagementService.getAllInstances();
  const identity = identifySender(sender);
  const onlyIds = scopeIds(identity, instances);
  const eligible: InstanceConfig[] = visibleTo(identity, instances).filter(
    (instance: InstanceConfig) => UP.has(serverProcessService.getNormalizedInstanceState(instance.id))
  );

  for (const { id } of eligible) {
    messagingService.sendToAll('server-instance-state', { instanceId: id, state: 'stopping' });
  }

  afterReply(async () => { await serverLifecycleService.stopAllInstances(onlyIds); });
  return { success: true, stopping: eligible.map(instance => instance.id) };
});

onRequest('force-stop-server-instance', async (payload, { sender }) => {
  const { id } = payload;
  const remote = await forwardRemote('force-stop', id, sender);
  if (remote) return remote;
  const result = await localRuntime.forceStop(id);
  if (result.success) {
    messagingService.sendToAll('rcon-status', { instanceId: id, connected: false });
    messagingService.sendToAll('server-instance-log', { log: '[FORCE STOP] Server force stopped', instanceId: id });
    serverMonitoringService.stopPlayerPolling(id);
    if (result.shouldNotifyAutomation) {
      automationService.setManuallyStopped(id, true);
    }
    messagingService.sendToAll('notification', { type: 'warning', message: `${result.instanceName} force stopped.`, instanceId: id });
  }
  return result;
}, { fallbackError: 'Failed to force stop server' });

// SaveWorld, DoExit, a wait for the process, then a kill if it is still there: can take minutes.
onRequest('stop-server-instance', async (payload, { sender }) => {
  const { id } = payload;
  if (!validateInstanceId(id)) {
    return { success: false, instanceId: id, error: 'Invalid instance ID' };
  }
  const remote = await forwardRemote('stop', id, sender);
  if (remote) return remote;
  const result = await localRuntime.stop(id);
  if (result.success) {
    serverMonitoringService.stopPlayerPolling(id);
    automationService.setManuallyStopped(id, true);
    messagingService.sendToAll('rcon-status', { instanceId: id, connected: false });
    await meshService.noteDesired(id, 'stopped');
  }
  return { success: result.success, instanceId: id, error: result.error };
}, { onError: (error, payload) => ({ success: false, instanceId: payload.id, error }) });

onRequest('get-server-instance-state', payload => {
  const { id } = payload;
  return { state: localRuntime.state(id), instanceId: id };
}, { onError: (_error, payload) => ({ state: 'unknown', instanceId: payload.id }) });

onRequest('get-server-instance-logs', payload => {
  const { log, instanceId } = localRuntime.logs(payload.id, payload.maxLines);
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
  const result = await localRuntime.rcon(payload.id, payload.command);
  return { instanceId: result.instanceId, response: result.response || result.error || 'No response' };
}, {
  fallbackError: 'RCON command failed',
  onError: (error, payload) => ({ instanceId: payload.id, response: error })
});

onRequest('start-server-instance', async (payload, { sender }) => {
  const { id } = payload;
  const remote = await forwardRemote('start', id, sender);
  if (remote) return remote;
  messagingService.sendToAll('clear-server-instance-logs', { instanceId: id });
  const { onLog, onState } = getStandardEventCallbacks(id);
  const result = await localRuntime.start(id, onLog, onState);

  if (result.started) {
    messagingService.sendToAll('notification', { type: 'info', message: `${result.instanceName} started.`, instanceId: id });
    await meshService.noteDesired(id, 'running');
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

onRequest('get-server-instances', async (_payload, { sender, afterReply }) => {
  const { instances } = await localRuntime.listInstances();
  const merged = await meshService.withMeshServers(instances);
  // The broadcast carries the full list, including servers hosted on other machines.
  afterReply(() => { void serverInstanceService.broadcastInstances(); });
  return { instances: visibleTo(identifySender(sender), merged) };
}, { onError: () => ({ instances: [] }) });

onRequest('get-server-instance', async payload => {
  const { instance } = await localRuntime.getInstance(payload.id);
  if (instance) return { instance };
  return { instance: await meshService.remoteInstance(String(payload.id || '')) };
}, { onError: () => ({ instance: null }) });

onRequest('save-server-instance', async (payload, { sender, afterReply }) => {
  const { instance } = payload;
  const previous: InstanceConfig | null = instance?.id ? instanceUtils.getInstance(instance.id) : null;
  const identity = identifySender(sender);

  // The channel opens on either permission; which half applies depends on whether the server exists.
  if (!identity.isAdmin) {
    if (!previous && !identity.permissions.includes(PERMISSIONS.SERVERS_CREATE)) {
      return { success: false, error: 'Only an admin or operator can add a server.' };
    }
    if (previous && !identity.permissions.includes(PERMISSIONS.SERVERS_CONFIGURE)) {
      return { success: false, error: 'Your role cannot change server settings.' };
    }
  }
  if (instance && typeof instance === 'object') {
    const refusal = applyServerOwnership(instance, previous, identity, lookupUser);
    if (refusal) return { success: false, error: refusal };
  }

  const result = await localRuntime.saveInstance(instance);

  if (result.success && result.instance) {
    const saved: InstanceConfig = result.instance;
    try {
      await meshService.recordServer(saved);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Could not update mesh placement.' };
    }
    afterReply(() => messagingService.sendToAll('server-instance-updated', saved));
    afterReply(() => serverInstanceService.broadcastInstances());
    afterReply(() => messagingService.sendToAllOthers('notification', { type: 'info', message: describeSave(previous, saved), instanceId: saved.id }, sender));
  }
  return { success: result.success, instance: result.instance, error: result.error };
}, { fallbackError: 'Failed to save server instance' });

/** Reply and broadcast for a change to a server's ownership. */
function ownershipSaved(channel: string, saved: InstanceConfig, afterReply: (fn: () => void | Promise<void>) => void) {
  afterReply(() => messagingService.sendToAll('server-instance-updated', saved));
  afterReply(() => serverInstanceService.broadcastInstances());
  return { success: true, instance: saved };
}

onRequest('assign-server-manager', async (payload, { sender, afterReply }) => {
  const { instanceId, managerUserId } = payload;
  const existing: InstanceConfig | null = typeof instanceId === 'string' ? instanceUtils.getInstance(instanceId) : null;
  if (!existing) return { success: false, error: 'That server was not found.' };
  const identity = identifySender(sender);
  if (!canAssignFor(identity, existing)) return { success: false, error: 'That server is not in your pool.' };

  const assignee = managerUserId || null;
  const refusal = assigneeRefusal(assignee, existing.operatorUserId, lookupUser);
  if (refusal) return { success: false, error: refusal };

  const saved = await instanceUtils.saveInstance({ ...existing, managerUserId: assignee });
  if (saved.error !== undefined) return { success: false, error: saved.error };
  return ownershipSaved('assign-server-manager', saved, afterReply);
}, { fallbackError: 'Could not assign that server manager.' });

onRequest('set-server-operator', async (payload, { sender, afterReply }) => {
  const { instanceId } = payload;
  if (!identifySender(sender).isAdmin) return { success: false, error: 'Only an admin can move a server between pools.' };
  const existing: InstanceConfig | null = typeof instanceId === 'string' ? instanceUtils.getInstance(instanceId) : null;
  if (!existing) return { success: false, error: 'That server was not found.' };

  const operatorUserId: string | null = payload.operatorUserId || null;
  if (operatorUserId) {
    const refusal = operatorRefusal(operatorUserId, lookupUser);
    if (refusal) return { success: false, error: refusal };
  }
  // An assignee from the old pool cannot follow the server into the new one.
  const keepAssignee = !!existing.managerUserId && assigneeRefusal(existing.managerUserId, operatorUserId, lookupUser) === null;
  const saved = await instanceUtils.saveInstance({ ...existing, operatorUserId, managerUserId: keepAssignee ? existing.managerUserId : null });
  if (saved.error !== undefined) return { success: false, error: saved.error };
  return ownershipSaved('set-server-operator', saved, afterReply);
}, { fallbackError: 'Could not move that server.' });

onRequest('delete-server-instance', async (payload, { sender, afterReply }) => {
  const { id } = payload;
  const result = await localRuntime.deleteInstance(id);

  if (result.success) {
    afterReply(() => serverInstanceService.broadcastInstances());
    afterReply(() => activityLogService.record('info', 'Server deleted', id, identifySender(sender).user?.username || null));
    afterReply(() => messagingService.sendToAllOthers('notification', { type: 'info', message: 'Server deleted.', instanceId: id }, sender));
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
  let instance = result.instance;
  if (result.success && instance) {
    // Lands in the importer's pool, as a server they created would.
    instance = await stampImportedPool(instance, sender);
    afterReply(() => serverInstanceService.broadcastInstances());
  }
  return { success: result.success, instance, message: result.message, error: result.error };
}, { fallbackError: 'Failed to import server from backup' });

async function stampImportedPool(imported: InstanceConfig, sender: MessageSender): Promise<InstanceConfig> {
  const identity = identifySender(sender);
  if (identity.isAdmin) return imported;
  const stamped: Partial<InstanceConfig> = { ...imported };
  if (applyServerOwnership(stamped, null, identity, lookupUser)) return imported;
  const saved = await instanceUtils.saveInstance(stamped);
  return saved.error === undefined ? saved : imported;
}

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

onRequest('restart-server-instance', async (payload, { sender }) => {
  const { id } = payload;
  const remote = await forwardRemote('restart', id, sender);
  if (remote) return remote;
  const stopped = await localRuntime.stop(id);
  if (!stopped.success) return { success: false, instanceId: id, error: stopped.error };
  const { onLog, onState } = getStandardEventCallbacks(id);
  const started = await localRuntime.start(id, onLog, onState);
  return { success: started.started, instanceId: id, error: started.portError };
}, { onError: (error, payload) => ({ success: false, instanceId: payload.id, error }) });

async function forwardRemote(operation: 'start' | 'stop' | 'force-stop' | 'restart', id: string, sender: MessageSender) {
  const actor = identifySender(sender).user?.username || 'desktop';
  const remote = await meshService.forwardIfRemote(operation, id, actor);
  if (!remote) return null;
  return { success: remote.success, instanceId: id, error: remote.error };
}

function describeSave(previous: InstanceConfig | null, saved: InstanceConfig): string {
  if (previous && previous.name !== saved.name) {
    return `Server renamed from "${previous.name}" to "${saved.name}".`;
  }
  if (previous) {
    return `Server "${saved.name || saved.id}" updated.`;
  }
  return `Server "${saved.name || saved.id || 'Unknown'}" added.`;
}
