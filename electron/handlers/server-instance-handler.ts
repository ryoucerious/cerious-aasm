import * as instanceUtils from '../utils/ark/instance.utils';
import { messagingService } from '../services/messaging.service';
import { serverInstanceService } from '../services/server-instance/server-instance.service';
import { serverLifecycleService } from '../services/server-instance/server-lifecycle.service';
import { serverMonitoringService } from '../services/server-instance/server-monitoring.service';
import { serverOperationsService } from '../services/server-instance/server-operations.service';
import { serverManagementService } from '../services/server-instance/server-management.service';
import { automationService } from '../services/automation/automation.service';
import { identifySender } from '../services/auth/permission-gate';
import { canAssignServerManager, filterInstancesForUser, isServerManager, isServerScoped } from '../services/auth/server-assignment';
import { userDatabaseService } from '../services/auth/user-database.service';
import { hasPermission, isAssignableRole, PERMISSIONS, ROLE_IDS } from '../types/auth.types';

const { arkConfigService } = require('../services/ark-config.service');

/** null means every server. An array is the servers this sender is allowed to touch. */
async function serverIdsForSender(sender: any): Promise<string[] | null> {
  const identity = identifySender(sender);
  if (!isServerScoped(identity) || !identity.user) return null;
  const instances = await instanceUtils.getAllInstances();
  return filterInstancesForUser(identity.user, instances).map((instance: any) => instance.id);
}

/**
 * Stamp which operator owns a server, and refuse an assignee from a different group.
 * A missing operatorUserId on an edit keeps the one already stored.
 */
function applyServerOwnership(instance: any, existing: any, identity: { isAdmin: boolean; user: { id: string; roleId: string } | null }): string | null {
  if (!existing) {
    if (identity.user?.roleId === ROLE_IDS.OPERATOR) {
      instance.operatorUserId = identity.user.id;
    } else if (identity.isAdmin) {
      const requested = instance.operatorUserId || null;
      if (requested) {
        const operator = userDatabaseService.getUser(requested);
        if (!operator || !operator.active || operator.roleId !== ROLE_IDS.OPERATOR) return 'Choose an active operator for this server.';
        instance.operatorUserId = operator.id;
      } else {
        instance.operatorUserId = null;
      }
    } else {
      instance.operatorUserId = null;
    }
  } else if (!identity.isAdmin) {
    if (identity.user?.roleId === ROLE_IDS.OPERATOR && (existing.operatorUserId || null) !== identity.user.id) {
      return 'That server is not in your group.';
    }
    instance.operatorUserId = existing.operatorUserId ?? null;
  } else if (instance.operatorUserId === undefined) {
    instance.operatorUserId = existing.operatorUserId ?? null;
  } else {
    const requested = instance.operatorUserId || null;
    if (requested) {
      const operator = userDatabaseService.getUser(requested);
      if (!operator || !operator.active || operator.roleId !== ROLE_IDS.OPERATOR) return 'Choose an active operator for this server.';
      instance.operatorUserId = operator.id;
    } else {
      instance.operatorUserId = null;
    }
  }

  if (instance.managerUserId) {
    const manager = userDatabaseService.getUser(instance.managerUserId);
    if (!manager || !manager.active || !isAssignableRole(manager.roleId)) {
      return 'Choose an active server manager or attendant.';
    }
    if ((manager.ownerUserId || null) !== (instance.operatorUserId || null)) {
      return 'That person is not in this server\'s group.';
    }
  }
  return null;
}

// feature: ini editor //
/**
 * Handle 'get-ini-file' requests from renderer
 */
messagingService.on('get-ini-file', (payload: any, sender: any) => {
    const { instanceId, filename, requestId } = payload;
    try {
        const content = arkConfigService.readIniFile(instanceId, filename);
        messagingService.sendToOriginator('get-ini-file', { success: true, content, instanceId, filename, requestId }, sender);
    } catch (error) {
        messagingService.sendToOriginator('get-ini-file', { success: false, error: (error as Error).message, requestId }, sender);
    }
});

/**
 * Handle 'save-ini-file' requests from renderer
 */
messagingService.on('save-ini-file', (payload: any, sender: any) => {
    const { instanceId, filename, content, requestId } = payload;
    try {
        arkConfigService.writeIniFile(instanceId, filename, content);

        // Parse INI back to config keys and merge into config.json
        try {
            const { getInstancesBaseDir } = require('../utils/ark/instance.utils');
            const fs = require('fs');
            const path = require('path');
            const configPath = path.join(getInstancesBaseDir(), instanceId, 'config.json');
            if (fs.existsSync(configPath)) {
                const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                const parsed = arkConfigService.parseIniToConfig(filename, content);
                const merged = { ...existing, ...parsed };
                fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
                // Notify renderer of the updated instance
                messagingService.sendToAll('server-instance-updated', merged);
            }
        } catch (mergeErr) {
            console.warn('[save-ini-file] Could not merge INI back to config.json:', mergeErr);
        }

        messagingService.sendToOriginator('save-ini-file', { success: true, instanceId, filename, requestId }, sender);
    } catch (error) {
        messagingService.sendToOriginator('save-ini-file', { success: false, error: (error as Error).message, requestId }, sender);
    }
});

// Feature #7: Cluster Control
messagingService.on('start-all-instances', async (payload: any, sender: any) => {
    const { requestId } = payload || {};
    try {
        const { serverProcessService } = require('../services/server-instance/server-process.service');
        const allInstances = (await serverManagementService.getAllInstances()).instances;
        const onlyIds = await serverIdsForSender(sender);
        const scopedInstances = onlyIds
          ? allInstances.filter((inst: any) => onlyIds.includes(inst.id))
          : allInstances;

        // Determine which instances are eligible to start (skip already-running, starting, or queued)
        const eligible = scopedInstances.filter((inst: any) => {
            const state = serverProcessService.getNormalizedInstanceState(inst.id);
            return state !== 'running' && state !== 'starting' && state !== 'queued';
        });

        // Immediately set backend state to 'queued' and broadcast so the UI updates right away.
        // This ensures get-server-instance-state returns 'queued' even before the staggered start begins.
        for (const inst of eligible) {
            serverProcessService.setInstanceState(inst.id, 'queued');
            messagingService.sendToAll('server-instance-state', { instanceId: inst.id, state: 'queued' });
        }

        // Acknowledge the request immediately — don't make the frontend wait for staggered starts
        messagingService.sendToOriginator('start-all-instances', { success: true, requestId, starting: eligible.map((i: any) => i.id) }, sender);

        // Start instances in the background; getStandardEventCallbacks handles all further state transitions
        serverLifecycleService.startAllInstances(undefined, onlyIds).catch((err: Error) => {
            console.error('[start-all-instances] Background start error:', err);
        });
    } catch (error) {
        messagingService.sendToOriginator('start-all-instances', { success: false, requestId, error: (error as Error).message }, sender);
    }
});

messagingService.on('stop-all-instances', async (payload: any, sender: any) => {
    const { requestId } = payload || {};
    try {
        const { serverProcessService } = require('../services/server-instance/server-process.service');
        const allInstances = (await serverManagementService.getAllInstances()).instances;
        const onlyIds = await serverIdsForSender(sender);
        const scopedInstances = onlyIds
          ? allInstances.filter((inst: any) => onlyIds.includes(inst.id))
          : allInstances;

        // Determine which instances are eligible to stop
        const eligible = scopedInstances.filter((inst: any) => {
            const state = serverProcessService.getNormalizedInstanceState(inst.id);
            return state === 'running' || state === 'starting';
        });

        // Immediately broadcast 'stopping' for each eligible instance so the UI updates right away
        for (const inst of eligible) {
            messagingService.sendToAll('server-instance-state', { instanceId: inst.id, state: 'stopping' });
        }

        // Acknowledge the request immediately
        messagingService.sendToOriginator('stop-all-instances', { success: true, requestId, stopping: eligible.map((i: any) => i.id) }, sender);

        // Stop instances in the background; lifecycle callbacks handle further state transitions
        serverLifecycleService.stopAllInstances(onlyIds).catch((err: Error) => {
            console.error('[stop-all-instances] Background stop error:', err);
        });
    } catch (error) {
        messagingService.sendToOriginator('stop-all-instances', { success: false, requestId, error: (error as Error).message }, sender);
    }
});

/** Handles the 'force-stop-server-instance' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the ServerInstanceService to force stop a server instance.
 * It then sends the result back to the originator of the message, including details such as
 * success status, instance ID, and any error information.
 * If the force stop is successful, it broadcasts relevant updates such as RCON status,
 * server logs, and notifications to all connected clients.
 * In case of unexpected errors during the force stop, it logs the error and sends a failure
 * response.
 * 
 * @param payload - The payload received with the message, expected to contain `id` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
*/
messagingService.on('force-stop-server-instance', async (payload, sender) => {
  const { id, requestId } = payload || {};
  
  try {
    const result = await serverInstanceService.forceStopInstance(id);
    
    if (result.success) {
      // Broadcast RCON status and logs
      messagingService.sendToAll('rcon-status', { instanceId: id, connected: false });
      messagingService.sendToAll('server-instance-log', { log: '[FORCE STOP] Server force stopped', instanceId: id });
      serverMonitoringService.stopPlayerPolling(id);
      
      // Notify automation service if needed
      if (result.shouldNotifyAutomation) {
        automationService.setManuallyStopped(id, true);
      }
      
      // Broadcast notification using service-provided name
      messagingService.sendToAll('notification', {
        type: 'warning',
        message: `${result.instanceName} force stopped.`,
        instanceId: id
      });
    }
    
    messagingService.sendToOriginator('force-stop-server-instance', {
      ...result,
      requestId
    }, sender);
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle force-stop-server-instance:', error);
    messagingService.sendToOriginator('force-stop-server-instance', {
      success: false,
      error: (error as Error)?.message || 'Failed to force stop server',
      requestId
    }, sender);
  }
});

/** Handles the 'get-server-instance-state' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the ServerInstanceService to get the current state of a server instance.
 * It then sends the result back to the originator of the message, including details such as
 * the current state and instance ID.
 * In case of unexpected errors during the state retrieval, it logs the error and sends a failure
 * response to the originator.
 * 
 * @param payload - The payload received with the message, expected to contain `id` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
*/
messagingService.on('get-server-instance-state', async (payload, sender) => {
  const { id, requestId } = payload || {};
  
  try {
    const { getNormalizedInstanceState } = require('../utils/ark/ark-server/ark-server-state.utils');
    const state = getNormalizedInstanceState(id);
    messagingService.sendToOriginator('get-server-instance-state', {
      state,
      instanceId: id,
      requestId
    }, sender);
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle get-server-instance-state:', error);
    messagingService.sendToOriginator('get-server-instance-state', {
      state: 'unknown',
      instanceId: id,
      requestId
    }, sender);
  }
});

/** Handles the 'get-server-instance-logs' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the ServerInstanceService to get the logs of a server instance.
 * It then sends the result back to the originator of the message, including details such as
 * the logs and instance ID.
 * In case of unexpected errors during the logs retrieval, it logs the error and sends a failure
 * response to the originator.
 * 
 * @param payload - The payload received with the message, expected to contain `id`, `maxLines`, and `requestId`.
 * @param sender - The sender of the message, used to route the response.
*/
messagingService.on('get-server-instance-logs', async (payload, sender) => {
  const { id, maxLines, requestId } = payload || {};
  
  try {
    const result = serverMonitoringService.getInstanceLogs(id, maxLines);
    
    messagingService.sendToOriginator('get-server-instance-logs', {
      log: result.log,
      instanceId: result.instanceId,
      requestId
    }, sender);
    
    messagingService.sendToAll('get-server-instance-logs', {
      log: result.log,
      instanceId: result.instanceId,
      requestId
    });
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle get-server-instance-logs:', error);
    messagingService.sendToOriginator('get-server-instance-logs', {
      log: '',
      instanceId: id,
      requestId
    }, sender);
  }
});

/** Handles the 'connect-rcon' message event from the messaging service.
 * 
 * When triggered, this handler invokes the ServerInstanceService to connect to the RCON interface of a server instance.
 * It then sends the result back to the originator of the message, including details such as
 * the connection status and instance ID.
 * In case of unexpected errors during the connection attempt, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `id` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('connect-rcon', async (payload, sender) => {
  const { id, requestId } = payload || {};
  
  try {
    const result = await serverOperationsService.connectRcon(id);
    
    messagingService.sendToOriginator('connect-rcon', {
      success: result.success,
      connected: result.connected,
      instanceId: result.instanceId,
      error: result.error,
      requestId
    }, sender);
    
    messagingService.sendToAll('rcon-status', {
      instanceId: id,
      connected: result.connected || false
    });
    
    if (result.connected) {
      serverMonitoringService.startPlayerPolling(id, (instanceId: string, count: number) => {
        messagingService.sendToAll('server-instance-players', { instanceId, players: count });
      });
    }
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle connect-rcon:', error);
    messagingService.sendToOriginator('connect-rcon', {
      success: false,
      connected: false,
      instanceId: id,
      error: (error as Error)?.message || 'Failed to connect RCON',
      requestId
    }, sender);
  }
});

/**
 * Handles the 'get-online-players' request.
 * Fetches and parses the list of online players from RCON.
 */
messagingService.on('get-online-players', async (payload, sender) => {
  const { id, requestId } = payload || {};
  try {
    const rconService = require('../services/rcon.service').rconService;
    const players = await rconService.getOnlinePlayers(id);
    
    messagingService.sendToOriginator('get-online-players', {
      success: true,
      instanceId: id,
      players: players,
      requestId
    }, sender);
  } catch (error) {
    console.error(`[server-instance-handler] Failed to get online players for ${id}:`, error);
    messagingService.sendToOriginator('get-online-players', {
      success: false,
      instanceId: id,
      error: (error as Error)?.message,
      requestId
    }, sender);
  }
});

/** Handles the 'disconnect-rcon' message event from the messaging service.
 * 
 * When triggered, this handler invokes the ServerInstanceService to disconnect from the RCON interface of a server instance.
 * It then sends the result back to the originator of the message, including details such as
 * the disconnection status and instance ID.
 * In case of unexpected errors during the disconnection attempt, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `id` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('disconnect-rcon', async (payload, sender) => {
  const { id, requestId } = payload || {};
  
  try {
    const result = await serverOperationsService.disconnectRcon(id);
    
    messagingService.sendToOriginator('disconnect-rcon', {
      success: result.success,
      connected: result.connected,
      instanceId: result.instanceId,
      requestId
    }, sender);
    
    messagingService.sendToAll('rcon-status', {
      instanceId: id,
      connected: false
    });
    
    serverMonitoringService.stopPlayerPolling(id);
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle disconnect-rcon:', error);
    messagingService.sendToOriginator('disconnect-rcon', {
      success: false,
      connected: false,
      instanceId: id,
      requestId
    }, sender);
  }
});

/** Handles the 'get-rcon-status' message event from the messaging service.
 * 
 * When triggered, this handler invokes the ServerInstanceService to get the RCON status of a server instance.
 * It then sends the result back to the originator of the message, including details such as
 * the connection status and instance ID.
 * In case of unexpected errors during the status retrieval, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `id` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('get-rcon-status', async (payload, sender) => {
  const { id, requestId } = payload || {};
  
  try {
    const result = serverOperationsService.getRconStatus(id);
    
    messagingService.sendToOriginator('get-rcon-status', {
      success: result.success,
      connected: result.connected,
      instanceId: result.instanceId,
      requestId
    }, sender);
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle get-rcon-status:', error);
    messagingService.sendToOriginator('get-rcon-status', {
      success: false,
      connected: false,
      instanceId: id,
      requestId
    }, sender);
  }
});

/** Handles the 'rcon-command' message event from the messaging service.
 * 
 * When triggered, this handler invokes the ServerInstanceService to execute an RCON command on a server instance.
 * It then sends the result back to the originator of the message, including details such as
 * the command execution status and instance ID.
 * In case of unexpected errors during the command execution, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `id`, `command`, and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('rcon-command', async (payload, sender) => {
  const { id, command, requestId } = payload || {};
  
  try {
    const result = await serverOperationsService.executeRconCommand(id, command);
    
    messagingService.sendToOriginator('rcon-command', {
      instanceId: result.instanceId,
      response: result.response || result.error || 'No response',
      requestId
    }, sender);
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle rcon-command:', error);
    messagingService.sendToOriginator('rcon-command', {
      instanceId: id,
      response: (error as Error)?.message || 'RCON command failed',
      requestId
    }, sender);
  }
});

/** Handles the 'start-server-instance' message event from the messaging service.
 * 
 * When triggered, this handler invokes the ServerInstanceService to start a server instance.
 * It then sends the result back to the originator of the message, including details such as
 * the start status and instance ID.
 * In case of unexpected errors during the start process, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `id` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('start-server-instance', async (payload, sender) => {
  const { id, requestId } = payload || {};
  
  try {
    messagingService.sendToAll('clear-server-instance-logs', { instanceId: id });
    const { onLog, onState } = serverInstanceService.getStandardEventCallbacks(id);
    const result = await serverInstanceService.startServerInstance(id, onLog, onState);
    
    if (result.started) {
      messagingService.sendToAll('notification', {
        type: 'info',
        message: `${result.instanceName} started.`,
        instanceId: id
      });
    } else {
      if (result.portError && sender && typeof sender.send === 'function') {
        sender.send('notification', {
          type: 'error',
          message: result.portError
        });
      }
    }
    
    messagingService.sendToOriginator('start-server-instance', {
      success: result.started,
      instanceId: result.instanceId,
      error: result.portError,
      requestId
    }, sender);
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle start-server-instance:', error);
    messagingService.sendToOriginator('start-server-instance', {
      success: false,
      instanceId: id,
      error: (error as Error)?.message || 'Failed to start server',
      requestId
    }, sender);
  }
});

/** Handles the 'get-server-instance-players' message event from the messaging service.
 * 
 * When triggered, this handler invokes the ServerInstanceService to retrieve the player count
 * for a specific server instance. It then sends the result back to the originator of the message,
 * including details such as the instance ID and player count.
 * In case of unexpected errors during the player count retrieval, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `id` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('get-server-instance-players', async (payload, sender) => {
  const { id, requestId } = payload || {};
  
  try {
    const result = serverMonitoringService.getPlayerCount(id);
    
    messagingService.sendToOriginator('get-server-instance-players', {
      instanceId: result.instanceId,
      players: result.players,
      requestId
    }, sender);
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle get-server-instance-players:', error);
    messagingService.sendToOriginator('get-server-instance-players', {
      instanceId: id,
      players: 0,
      requestId
    }, sender);
  }
});

/** Handles the 'get-server-instances' message event from the messaging service.
 * 
 * When triggered, this handler invokes the ServerInstanceService to retrieve all server instances.
 * It then sends the result back to the originator of the message, including details such as
 * the list of instances.
 * In case of unexpected errors during the retrieval process, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('get-server-instances', async (payload, sender) => {
  const { requestId } = payload || {};
  
  try {
    const result = await serverManagementService.getAllInstances();
    const identity = identifySender(sender);
    const instances = filterInstancesForUser(identity.user, result.instances);
    
    messagingService.sendToOriginator('get-server-instances', {
      instances,
      requestId
    }, sender);
    
    messagingService.sendToAll('server-instances', result.instances);
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle get-server-instances:', error);
    messagingService.sendToOriginator('get-server-instances', {
      instances: [],
      requestId
    }, sender);
  }
});

/** Handles the 'get-server-instance' message event from the messaging service.
 * 
 * When triggered, this handler invokes the ServerInstanceService to retrieve a specific server instance.
 * It then sends the result back to the originator of the message, including details such as the instance ID.
 * In case of unexpected errors during the retrieval process, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `id` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('get-server-instance', async (payload, sender) => {
  const { id, requestId } = payload || {};
  
  try {
    const result = await serverManagementService.getInstance(id);
    const identity = identifySender(sender);
    const visible = filterInstancesForUser(identity.user, result.instance ? [result.instance] : []);
    
    messagingService.sendToOriginator('get-server-instance', {
      instance: visible[0] || null,
      requestId
    }, sender);
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle get-server-instance:', error);
    messagingService.sendToOriginator('get-server-instance', {
      instance: null,
      requestId
    }, sender);
  }
});

/** Handles the 'save-server-instance' message event from the messaging service.
 * 
 * When triggered, this handler invokes the ServerInstanceService to save a server instance.
 * It then sends the result back to the originator of the message, including details such as
 * the success status and any error messages.
 * In case of unexpected errors during the save process, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `instance` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('save-server-instance', async (payload, sender) => {
  const { instance, requestId } = payload || {};
  
  try {
    const existingInstance = instance?.id ? await instanceUtils.getInstance(instance.id) : null;
    const identity = identifySender(sender);
    if (!existingInstance && !identity.isAdmin && !hasPermission(identity.permissions, PERMISSIONS.SERVERS_CREATE)) {
      messagingService.sendToOriginator('save-server-instance', {
        success: false,
        error: 'Only an admin or operator can add a server.',
        requestId
      }, sender);
      return;
    }
    if (existingInstance && !identity.isAdmin && !hasPermission(identity.permissions, PERMISSIONS.SERVERS_CONFIGURE)) {
      messagingService.sendToOriginator('save-server-instance', {
        success: false,
        error: 'Your role cannot change server settings.',
        requestId
      }, sender);
      return;
    }
    if (instance && typeof instance === 'object') {
      if (!existingInstance && isServerManager(identity) && identity.user) {
        instance.managerUserId = identity.user.id;
      } else if (!canAssignServerManager(identity)) {
        instance.managerUserId = existingInstance?.managerUserId ?? null;
      } else if (instance.managerUserId === undefined) {
        instance.managerUserId = existingInstance?.managerUserId ?? null;
      }
      const ownershipError = applyServerOwnership(instance, existingInstance, identity);
      if (ownershipError) {
        messagingService.sendToOriginator('save-server-instance', {
          success: false,
          error: ownershipError,
          requestId
        }, sender);
        return;
      }
    }
    
    const result = await serverManagementService.saveInstance(instance);
    
    messagingService.sendToOriginator('save-server-instance', {
      success: result.success,
      instance: result.instance,
      error: result.error,
      requestId
    }, sender);
    
    if (result.success && result.instance) {
      messagingService.sendToAll('server-instance-updated', result.instance);
      
      const allInstances = await serverManagementService.getAllInstances();
      messagingService.sendToAll('server-instances', allInstances.instances);
      
      let notificationMessage = '';
      if (existingInstance && existingInstance.name !== result.instance?.name) {
        notificationMessage = `Server renamed from "${existingInstance.name}" to "${result.instance?.name}".`;
      } else if (existingInstance) {
        notificationMessage = `Server "${result.instance?.name || result.instance?.id }" updated.`;
      } else {
        notificationMessage = `Server "${result.instance?.name || result.instance?.id || 'Unknown'}" added.`;
      }
      
      messagingService.sendToAllOthers('notification', {
        type: 'info',
        message: notificationMessage,
        instanceId: result.instance?.id
      }, sender);
    }
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle save-server-instance:', error);
    messagingService.sendToOriginator('save-server-instance', {
      success: false,
      error: (error as Error)?.message || 'Failed to save server instance',
      requestId
    }, sender);
  }
});

messagingService.on('assign-server-manager', async (payload: any, sender: any) => {
  const { instanceId, managerUserId, requestId } = payload || {};
  try {
    const identity = identifySender(sender);
    if (!canAssignServerManager(identity)) {
      messagingService.sendToOriginator('assign-server-manager', {
        success: false,
        error: 'Only an admin or operator can assign a server manager.',
        requestId
      }, sender);
      return;
    }
    const existing = instanceId ? await instanceUtils.getInstance(instanceId) : null;
    if (!existing) {
      messagingService.sendToOriginator('assign-server-manager', {
        success: false,
        error: 'That server was not found.',
        requestId
      }, sender);
      return;
    }
    const serverOperator = existing.operatorUserId || null;
    if (!identity.isAdmin && (identity.user?.roleId !== ROLE_IDS.OPERATOR || serverOperator !== identity.user.id)) {
      messagingService.sendToOriginator('assign-server-manager', {
        success: false,
        error: 'That server is not in your group.',
        requestId
      }, sender);
      return;
    }
    if (managerUserId) {
      const manager = userDatabaseService.getUser(managerUserId);
      if (!manager || !manager.active || !isAssignableRole(manager.roleId)) {
        messagingService.sendToOriginator('assign-server-manager', {
          success: false,
          error: 'Choose an active server manager or attendant.',
          requestId
        }, sender);
        return;
      }
      if ((manager.ownerUserId || null) !== serverOperator) {
        messagingService.sendToOriginator('assign-server-manager', {
          success: false,
          error: 'That person is not in this server\'s group.',
          requestId
        }, sender);
        return;
      }
    }
    const saved = await instanceUtils.saveInstance({
      ...existing,
      id: instanceId,
      operatorUserId: serverOperator,
      managerUserId: managerUserId || null
    });
    if (saved && (saved as any).error) {
      messagingService.sendToOriginator('assign-server-manager', {
        success: false,
        error: (saved as any).error,
        requestId
      }, sender);
      return;
    }
    messagingService.sendToOriginator('assign-server-manager', {
      success: true,
      instance: saved,
      requestId
    }, sender);
    messagingService.sendToAll('server-instance-updated', saved);
    const allInstances = await serverManagementService.getAllInstances();
    messagingService.sendToAll('server-instances', allInstances.instances);
  } catch (error) {
    messagingService.sendToOriginator('assign-server-manager', {
      success: false,
      error: (error as Error)?.message || 'Could not assign that server manager.',
      requestId
    }, sender);
  }
});

messagingService.on('set-server-operator', async (payload: any, sender: any) => {
  const { instanceId, requestId } = payload || {};
  const operatorUserId = payload?.operatorUserId || null;
  try {
    if (!identifySender(sender).isAdmin) {
      messagingService.sendToOriginator('set-server-operator', {
        success: false,
        error: 'Only an admin can move a server between groups.',
        requestId
      }, sender);
      return;
    }
    const existing = instanceId ? await instanceUtils.getInstance(instanceId) : null;
    if (!existing) {
      messagingService.sendToOriginator('set-server-operator', {
        success: false,
        error: 'That server was not found.',
        requestId
      }, sender);
      return;
    }
    if (operatorUserId) {
      const operator = userDatabaseService.getUser(operatorUserId);
      if (!operator || !operator.active || operator.roleId !== ROLE_IDS.OPERATOR) {
        messagingService.sendToOriginator('set-server-operator', {
          success: false,
          error: 'Choose an active operator.',
          requestId
        }, sender);
        return;
      }
    }
    let managerUserId = existing.managerUserId || null;
    if (managerUserId) {
      const manager = userDatabaseService.getUser(managerUserId);
      if (!manager || (manager.ownerUserId || null) !== operatorUserId) managerUserId = null;
    }
    const saved = await instanceUtils.saveInstance({
      ...existing,
      id: instanceId,
      operatorUserId,
      managerUserId
    });
    if (saved && (saved as any).error) {
      messagingService.sendToOriginator('set-server-operator', {
        success: false,
        error: (saved as any).error,
        requestId
      }, sender);
      return;
    }
    messagingService.sendToOriginator('set-server-operator', { success: true, instance: saved, requestId }, sender);
    messagingService.sendToAll('server-instance-updated', saved);
    const allInstances = await serverManagementService.getAllInstances();
    messagingService.sendToAll('server-instances', allInstances.instances);
  } catch (error) {
    messagingService.sendToOriginator('set-server-operator', {
      success: false,
      error: (error as Error)?.message || 'Could not move that server.',
      requestId
    }, sender);
  }
});

/** Handles the 'delete-server-instance' message event from the messaging service.
 * 
 * When triggered, this handler invokes the ServerInstanceService to delete a server instance.
 * It then sends the result back to the originator of the message, including details such as
 * the success status and any error messages.
 * In case of unexpected errors during the delete process, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `id` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('delete-server-instance', async (payload, sender) => {
  const { id, requestId } = payload || {};
  
  try {
    const result = await serverManagementService.deleteInstance(id);
    
    messagingService.sendToOriginator('delete-server-instance', {
      success: result.success,
      id: result.id,
      requestId
    }, sender);
    
    if (result.success) {
      const allInstances = await serverManagementService.getAllInstances();
      messagingService.sendToAll('server-instances', allInstances.instances);

      try {
        const { activityLogService } = require('../services/activity-log.service');
        const { identifySender } = require('../services/auth/permission-gate');
        activityLogService.record('info', 'Server deleted', id, identifySender(sender).user?.username || null);
      } catch {
        // The feed is a convenience; never fail a delete because of it.
      }

      messagingService.sendToAllOthers('notification', {
        type: 'info',
        message: 'Server deleted.',
        instanceId: id
      }, sender);
    }
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle delete-server-instance:', error);
    messagingService.sendToOriginator('delete-server-instance', {
      success: false,
      id,
      requestId
    }, sender);
  }
});

/** Handles the 'import-server-from-backup' message event from the messaging service.
 * 
 * When triggered, this handler invokes the ServerInstanceService to import a server instance
 * from a backup file. It then sends the result back to the originator of the message, including
 * details such as the success status and any error messages.
 * In case of unexpected errors during the import process, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `serverName`,
 * `backupFilePath`, `fileData`, `fileName`, and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('import-server-from-backup', async (payload, sender) => {
  const { serverName, backupFilePath, fileData, fileName, requestId } = payload || {};
  
  try {
    const result = await serverInstanceService.importServerFromBackup(serverName, backupFilePath, fileData, fileName);
    
    messagingService.sendToOriginator('import-server-from-backup', {
      success: result.success,
      instance: result.instance,
      message: result.message,
      error: result.error,
      requestId
    }, sender);
    
    if (result.success) {
      const allInstances = await serverManagementService.getAllInstances();
      messagingService.sendToAll('server-instances', allInstances.instances);
    }
  } catch (error) {
    console.error('[server-instance-handler] Failed to handle import-server-from-backup:', error);
    messagingService.sendToOriginator('import-server-from-backup', {
      success: false,
      error: (error as Error)?.message || 'Failed to import server from backup',
      requestId
    }, sender);
  }
});

console.log('[server-instance-handler] Server instance message handlers registered');

// =====================================================
// Reorder Server Instances Handler
// =====================================================

/**
 * Handles the 'reorder-server-instances' message event.
 * Updates the sortOrder property for each server instance based on the new order.
 */
messagingService.on('reorder-server-instances', async (payload, sender) => {
  try {
    const { orderedIds, requestId } = payload;
    if (!Array.isArray(orderedIds)) {
      messagingService.sendToOriginator('reorder-server-instances', {
        success: false,
        error: 'orderedIds must be an array',
        requestId
      }, sender);
      return;
    }

    // Update sortOrder for each instance
    const allInstances = await serverManagementService.getAllInstances();
    const instances = allInstances.instances || [];

    for (let i = 0; i < orderedIds.length; i++) {
      const instance = instances.find((inst: any) => inst.id === orderedIds[i]);
      if (instance) {
        instance.sortOrder = i;
        await serverManagementService.saveInstance(instance);
      }
    }

    // Broadcast updated list to all clients
    const updatedInstances = await serverManagementService.getAllInstances();
    messagingService.sendToAll('server-instances', updatedInstances.instances);

    messagingService.sendToOriginator('reorder-server-instances', {
      success: true,
      requestId
    }, sender);
  } catch (error) {
    console.error('[server-instance-handler] Failed to reorder server instances:', error);
    messagingService.sendToOriginator('reorder-server-instances', {
      success: false,
      error: (error as Error)?.message || 'Failed to reorder server instances'
    }, sender);
  }
});
