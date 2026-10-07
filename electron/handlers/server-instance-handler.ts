import { messagingService } from '../services/messaging.service';
import { serverInstanceService } from '../services/server-instance/server-instance.service';
import { getStandardEventCallbacks } from '../services/server-instance/instance-events';
import { serverLifecycleService } from '../services/server-instance/server-lifecycle.service';
import { serverMonitoringService } from '../services/server-instance/server-monitoring.service';
import { serverManagementService } from '../services/server-instance/server-management.service';
import { serverProcessService } from '../services/server-instance/server-process.service';
import { automationService } from '../services/automation/automation.service';
import { activityLogService } from '../services/activity-log.service';
import { identifySender, isDesktopWindow, SenderIdentity } from '../services/auth/permission-gate';
import { filterInstancesForUser } from '../services/auth/pool-access';
import { applyServerOwnership, assigneeRefusal, canAssignFor, operatorRefusal } from '../services/auth/server-ownership';
import { userDatabaseService } from '../services/auth/user-database.service';
import { PERMISSIONS, ROLE_IDS } from '../types/auth.types';
import type { MessageSender } from '../types/messaging.types';
import * as instanceUtils from '../utils/ark/instance.utils';
import { validateInstanceId } from '../utils/validation.utils';
import type { InstanceConfig } from '../types/server-instance.types';
import { localRuntime } from '../services/runtime/local-runtime';
import { meshService } from '../services/mesh/mesh-service';
import { localNode } from '../services/mesh/mesh-hooks';
import { onRequest } from './handler.utils';

const UP_OR_QUEUED = new Set(['running', 'starting', 'queued']);
const UP = new Set(['running', 'starting']);

const lookupUser = (id: string) => userDatabaseService.getUser(id);

/** The instances this sender may see: everything for an admin, their pool for anyone else. */
function visibleTo(identity: SenderIdentity, instances: InstanceConfig[]): InstanceConfig[] {
  return identity.isAdmin ? instances : filterInstancesForUser(identity.user, instances);
}

/** Who a command sent to another node is recorded as. */
function actorOf(sender: MessageSender): string {
  return identifySender(sender).user?.username || 'desktop';
}

/** The detail a remote command returned, typed for the caller. */
function detailOf<T>(result: { detail?: unknown }): Partial<T> {
  return (result.detail && typeof result.detail === 'object' ? result.detail : {}) as Partial<T>;
}

onRequest('get-ini-file', async payload => {
  const { instanceId, filename } = payload;
  const remote = await meshService.queryRemote<{ content: string }>(String(instanceId || ''), 'ini', { filename });
  const content = remote ? remote.content : localRuntime.readIni(instanceId, filename);
  return { success: true, content, instanceId, filename };
});

onRequest('save-ini-file', async (payload, { sender }) => {
  const { instanceId, filename, content } = payload;
  const remote = await meshService.forwardIfRemote('save-ini', String(instanceId || ''), actorOf(sender), { filename, content });
  if (remote) {
    const saved = detailOf<{ instance: InstanceConfig }>(remote).instance;
    if (saved) messagingService.sendToAll('server-instance-updated', saved);
    return remote.success ? { success: true, instanceId, filename } : { success: false, error: remote.error, instanceId, filename };
  }
  const saved = await localRuntime.saveIni(instanceId, filename, content);
  if (saved) messagingService.sendToAll('server-instance-updated', saved);
  return { success: true, instanceId, filename };
});

/**
 * What a Start All or Stop All from this sender covers: the visible servers hosted here, the ids
 * for the local lifecycle (undefined is every local server), and, per other node, the visible
 * servers that node hosts. A copy kept here of a server another node hosts is left out.
 */
async function planAll(identity: SenderIdentity) {
  const { instances } = await serverManagementService.getAllInstances();
  const visible = visibleTo(identity, await meshService.withMeshServers(instances));
  const hosts = await meshService.hostsOf(visible.map(instance => instance.id));
  const { local, remote } = onlyOwnMachine(identity, hosts);
  const hostedHere = new Set(local);
  const localVisible = visible.filter(instance => hostedHere.has(instance.id));
  const everyLocal = identity.isAdmin && instances.every(instance => hostedHere.has(instance.id));
  return { localVisible, onlyIds: everyLocal ? undefined : localVisible.map(instance => instance.id), remote };
}

/** A machine admin sees every server but starts and stops only those on its own machine. */
function onlyOwnMachine(identity: SenderIdentity, hosts: { local: string[]; remote: Map<string, string[]> }) {
  const user = identity.user;
  if (user?.roleId !== ROLE_IDS.MACHINE_ADMIN) return hosts;
  const machine = user.machineNodeId || '';
  if (machine && machine === localNode()) return { local: hosts.local, remote: new Map<string, string[]>() };
  const theirs = hosts.remote.get(machine);
  return { local: [], remote: new Map(theirs ? [[machine, theirs]] : []) };
}

/** The reply went out before other nodes answered, so a node that failed is reported separately. */
function reportHosts(results: Array<{ nodeName: string; result: { success: boolean; error?: string } }>, verb: string, sender: MessageSender): void {
  for (const { nodeName, result } of results) {
    if (result.success) continue;
    const message = `${nodeName} could not ${verb} its servers: ${result.error || 'no reason was given'}`;
    messagingService.sendToOriginator('notification', { type: 'error', message }, sender);
  }
}

onRequest('start-all-instances', async (_payload, { sender, afterReply }) => {
  const identity = identifySender(sender);
  const { localVisible, onlyIds, remote } = await planAll(identity);
  const eligible = localVisible.filter(instance => !UP_OR_QUEUED.has(serverProcessService.getNormalizedInstanceState(instance.id)));

  // Queued straight away, so get-server-instance-state says so before the staggered start reaches it.
  for (const { id } of eligible) {
    serverProcessService.setInstanceState(id, 'queued');
    messagingService.sendToAll('server-instance-state', { instanceId: id, state: 'queued' });
  }

  // Answered before the starts, which are staggered and report through the state callbacks.
  afterReply(async () => {
    const others = meshService.commandHosts('start-all', remote, identity.user?.username || 'desktop')
      .then(results => reportHosts(results, 'start', sender));
    const { started } = await serverLifecycleService.startAllInstances(undefined, onlyIds);
    for (const id of started) await meshService.noteDesired(id, 'running');
    await others;
  });
  return { success: true, starting: eligible.map(instance => instance.id) };
});

onRequest('stop-all-instances', async (_payload, { sender, afterReply }) => {
  const identity = identifySender(sender);
  const { localVisible, onlyIds, remote } = await planAll(identity);
  const eligible = localVisible.filter(instance => UP.has(serverProcessService.getNormalizedInstanceState(instance.id)));

  for (const { id } of eligible) {
    messagingService.sendToAll('server-instance-state', { instanceId: id, state: 'stopping' });
  }

  afterReply(async () => {
    const others = meshService.commandHosts('stop-all', remote, identity.user?.username || 'desktop')
      .then(results => reportHosts(results, 'stop', sender));
    const { stopped } = await serverLifecycleService.stopAllInstances(onlyIds);
    for (const id of stopped) await meshService.noteDesired(id, 'stopped');
    await others;
  });
  return { success: true, stopping: eligible.map(instance => instance.id) };
});

onRequest('force-stop-server-instance', async (payload, { sender }) => {
  const { id } = payload;
  const remote = await forwardRemote('force-stop', id, sender);
  if (remote) return remote;
  const result = await localRuntime.forceStop(id);
  if (result.success) {
    await meshService.noteDesired(id, 'stopped');
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

// A server hosted on another node is read from that node; its live events are relayed here.
onRequest('get-server-instance-state', async payload => {
  const { id } = payload;
  const remote = await meshService.queryRemote<{ state: string }>(String(id || ''), 'state');
  return { state: remote ? remote.state : localRuntime.state(id), instanceId: id };
}, { onError: (_error, payload) => ({ state: 'unknown', instanceId: payload.id }) });

onRequest('get-server-instance-logs', async payload => {
  const remote = await meshService.queryRemote<{ log: string }>(String(payload.id || ''), 'logs', { maxLines: payload.maxLines });
  if (remote) return { log: remote.log, instanceId: payload.id };
  const { log, instanceId } = localRuntime.logs(payload.id, payload.maxLines);
  return { log, instanceId };
}, { onError: (_error, payload) => ({ log: '', instanceId: payload.id }) });

onRequest('connect-rcon', async (payload, { sender, afterReply }) => {
  const { id } = payload;
  const remote = await meshService.forwardIfRemote('connect-rcon', String(id || ''), actorOf(sender));
  if (remote) return { success: remote.success, connected: !!detailOf<{ connected: boolean }>(remote).connected, instanceId: id, error: remote.error };
  const result = await localRuntime.connectRcon(id);
  afterReply(() => localRuntime.announceRcon(id, result.connected || false));
  return { success: result.success, connected: result.connected, instanceId: result.instanceId, error: result.error };
}, {
  fallbackError: 'Failed to connect RCON',
  onError: (error, payload) => ({ success: false, connected: false, instanceId: payload.id, error })
});

onRequest('get-online-players', async payload => {
  const { id } = payload;
  const remote = await meshService.queryRemote<{ players: unknown[] }>(String(id || ''), 'online-players');
  const players = remote ? remote.players : await localRuntime.onlinePlayers(id);
  return { success: true, instanceId: id, players };
}, { onError: (error, payload) => ({ success: false, instanceId: payload.id, error }) });

onRequest('disconnect-rcon', async (payload, { sender, afterReply }) => {
  const { id } = payload;
  const remote = await meshService.forwardIfRemote('disconnect-rcon', String(id || ''), actorOf(sender));
  if (remote) return { success: remote.success, connected: false, instanceId: id };
  const result = await localRuntime.disconnectRcon(id);
  afterReply(() => localRuntime.announceRconDown(id));
  return { success: result.success, connected: result.connected, instanceId: result.instanceId };
}, { onError: (_error, payload) => ({ success: false, connected: false, instanceId: payload.id }) });

onRequest('get-rcon-status', async payload => {
  const remote = await meshService.queryRemote<{ success: boolean; connected: boolean }>(String(payload.id || ''), 'rcon-status');
  if (remote) return { success: remote.success, connected: remote.connected, instanceId: payload.id };
  const { success, connected, instanceId } = localRuntime.rconStatus(payload.id);
  return { success, connected, instanceId };
}, { onError: (_error, payload) => ({ success: false, connected: false, instanceId: payload.id }) });

// The console shows `response` whatever happened, so failures go there too.
onRequest('rcon-command', async (payload, { sender }) => {
  const remote = await meshService.forwardIfRemote('rcon', String(payload.id || ''), actorOf(sender), { command: payload.command });
  if (remote) return { instanceId: payload.id, response: detailOf<{ response: string }>(remote).response || remote.error || 'No response' };
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

onRequest('get-server-instance-players', async payload => {
  const remote = await meshService.queryRemote<{ players: number }>(String(payload.id || ''), 'players');
  if (remote) return { instanceId: payload.id, players: remote.players };
  const { instanceId, players } = localRuntime.players(payload.id);
  return { instanceId, players };
}, { onError: (_error, payload) => ({ instanceId: payload.id, players: 0 }) });

onRequest('get-server-instances', async (_payload, { sender, afterReply }) => {
  const { instances } = await localRuntime.listInstances();
  const merged = await meshService.withMeshServers(instances);
  // The broadcast carries the full list, including servers hosted on other machines; each web
  // client receives its own pool's view of it.
  afterReply(() => messagingService.sendToAll('server-instances', merged));
  return { instances: visibleTo(identifySender(sender), merged) };
}, { onError: () => ({ instances: [] }) });

onRequest('get-server-instance', async payload => {
  const { instance } = await localRuntime.getInstance(payload.id);
  if (instance) return { instance };
  return { instance: await meshService.remoteInstance(String(payload.id || '')) };
}, { onError: () => ({ instance: null }) });

onRequest('save-server-instance', async (payload, { sender, afterReply }) => {
  const { instance } = payload;
  // A server hosted on another node has no config here; the mesh holds its last saved one.
  const previous: InstanceConfig | null = instance?.id
    ? (await meshService.remoteInstance(String(instance.id))) ?? instanceUtils.getInstance(instance.id)
    : null;
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
    // A machine admin adds servers to the machine it looks after.
    if (!previous && identity.user?.roleId === ROLE_IDS.MACHINE_ADMIN) instance.nodeId = identity.user.machineNodeId;
  }

  const isConfig = !!instance && typeof instance === 'object';
  const elsewhere = isConfig ? await meshService.saveElsewhere(instance, identity.user?.username || 'desktop') : null;
  let result: { success: boolean; instance?: InstanceConfig; error?: string };
  if (elsewhere) {
    result = elsewhere;
  } else {
    // Placement is decided above; the config saved here does not carry it.
    const { nodeId: _placement, ...config } = isConfig ? instance : {};
    result = await localRuntime.saveInstance(isConfig ? config : instance);
    if (result.success && result.instance) {
      try {
        await meshService.recordServer(result.instance);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Could not record the server in the mesh.' };
      }
    }
  }

  if (result.success && result.instance) {
    const saved: InstanceConfig = result.instance;
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

/** A server's config for an ownership change: from disk here, or from the mesh for one hosted elsewhere. */
async function serverForOwnership(instanceId: unknown): Promise<InstanceConfig | null> {
  if (typeof instanceId !== 'string') return null;
  return instanceUtils.getInstance(instanceId) ?? await meshService.remoteInstance(instanceId);
}

/** Applies an ownership change here, or on the node hosting the server. */
async function saveOwnership(
  channel: string,
  existing: InstanceConfig,
  patch: { operatorUserId?: string | null; managerUserId?: string | null },
  sender: MessageSender,
  afterReply: (fn: () => void | Promise<void>) => void
) {
  const remote = await meshService.forwardIfRemote('set-ownership', existing.id, actorOf(sender), patch);
  if (remote) {
    const saved = detailOf<{ instance: InstanceConfig }>(remote).instance;
    if (!remote.success || !saved) return { success: false, error: remote.error || 'That server was not saved.' };
    return ownershipSaved(channel, saved, afterReply);
  }
  const saved = await instanceUtils.saveInstance({ ...existing, ...patch });
  if (saved.error !== undefined) return { success: false, error: saved.error };
  return ownershipSaved(channel, saved, afterReply);
}

onRequest('assign-server-manager', async (payload, { sender, afterReply }) => {
  const { instanceId, managerUserId } = payload;
  const existing = await serverForOwnership(instanceId);
  if (!existing) return { success: false, error: 'That server was not found.' };
  const identity = identifySender(sender);
  if (!canAssignFor(identity, existing)) return { success: false, error: 'That server is not in your pool.' };

  const assignee = managerUserId || null;
  const refusal = assigneeRefusal(assignee, existing.operatorUserId, lookupUser);
  if (refusal) return { success: false, error: refusal };

  return saveOwnership('assign-server-manager', existing, { managerUserId: assignee }, sender, afterReply);
}, { fallbackError: 'Could not assign that server manager.' });

onRequest('set-server-operator', async (payload, { sender, afterReply }) => {
  const { instanceId } = payload;
  if (!identifySender(sender).isAdmin) return { success: false, error: 'Only an admin can move a server between pools.' };
  const existing = await serverForOwnership(instanceId);
  if (!existing) return { success: false, error: 'That server was not found.' };

  const operatorUserId: string | null = payload.operatorUserId || null;
  if (operatorUserId) {
    const refusal = operatorRefusal(operatorUserId, lookupUser);
    if (refusal) return { success: false, error: refusal };
  }
  // An assignee from the old pool cannot follow the server into the new one.
  const keepAssignee = !!existing.managerUserId && assigneeRefusal(existing.managerUserId, operatorUserId, lookupUser) === null;
  const managerUserId = keepAssignee ? (existing.managerUserId ?? null) : null;
  return saveOwnership('set-server-operator', existing, { operatorUserId, managerUserId }, sender, afterReply);
}, { fallbackError: 'Could not move that server.' });

onRequest('delete-server-instance', async (payload, { sender, afterReply }) => {
  const { id } = payload;
  let result: { success: boolean; error?: string; id?: string };
  const remote = await forwardRemote('delete', id, sender);
  if (remote) {
    result = remote;
    // An edit or a placement made on this machine can leave a copy of a server hosted elsewhere.
    if (remote.success && instanceUtils.getInstance(id)) await localRuntime.deleteInstance(id);
  } else {
    result = await meshService.deleteHostedServer(id, () => localRuntime.deleteInstance(id));
  }

  if (result.success) {
    afterReply(() => serverInstanceService.broadcastInstances());
    afterReply(() => activityLogService.record('info', 'Server deleted', id, identifySender(sender).user?.username || null));
    afterReply(() => messagingService.sendToAllOthers('notification', { type: 'info', message: 'Server deleted.', instanceId: id }, sender));
  }
  return { success: result.success, id: result.id ?? id, error: result.error };
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
    await meshService.recordServer(instance);
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
  if (started.started) await meshService.noteDesired(id, 'running');
  return { success: started.started, instanceId: id, error: started.portError };
}, { onError: (error, payload) => ({ success: false, instanceId: payload.id, error }) });

async function forwardRemote(operation: 'start' | 'stop' | 'force-stop' | 'restart' | 'delete', id: string, sender: MessageSender) {
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
