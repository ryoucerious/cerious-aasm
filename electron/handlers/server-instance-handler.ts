import * as instanceUtils from '../utils/ark/instance.utils';
import { messagingService } from '../services/messaging.service';
import { serverInstanceService } from '../services/server-instance/server-instance.service';
import { serverLifecycleService } from '../services/server-instance/server-lifecycle.service';
import { serverMonitoringService } from '../services/server-instance/server-monitoring.service';
import { serverOperationsService } from '../services/server-instance/server-operations.service';
import { serverManagementService } from '../services/server-instance/server-management.service';
import { automationService } from '../services/automation/automation.service';

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
        message: `Server ${result.instanceName} force stopped.`
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
        message: `Server ${result.instanceName} started.`
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
    
    messagingService.sendToOriginator('get-server-instances', {
      instances: result.instances,
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
    
    messagingService.sendToOriginator('get-server-instance', {
      instance: result.instance,
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
        message: notificationMessage
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
      
      messagingService.sendToAllOthers('notification', {
        type: 'info',
        message: 'Server deleted.'
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
