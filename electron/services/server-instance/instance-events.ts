import { messagingService } from '../messaging.service';
import { serverManagementService } from './server-management.service';
import { serverMonitoringService } from './server-monitoring.service';

export interface InstanceEventCallbacks {
  onLog: (line: string) => void;
  onState: (state: string) => void;
}

// States after which the instance list (state, uptime, players) every client shows is stale.
const LIST_CHANGING_STATES = new Set(['running', 'stopped', 'crashed']);

/**
 * Callbacks for a server being started: they broadcast its log lines and state changes and poll
 * its memory, players and CPU while it runs. RCON is connected by the process service.
 */
export function getStandardEventCallbacks(instanceId: string): InstanceEventCallbacks {
  return {
    onLog: log => messagingService.sendToAll('server-instance-log', { log, instanceId }),
    onState: state => {
      messagingService.sendToAll('server-instance-state', { state, instanceId });
      if (LIST_CHANGING_STATES.has(state)) {
        void broadcastInstanceList();
      }
      if (state === 'running') {
        startPolling(instanceId);
      } else {
        stopPolling(instanceId);
      }
    }
  };
}

async function broadcastInstanceList(): Promise<void> {
  try {
    const { instances } = await serverManagementService.getAllInstances();
    // Empty means the read failed: an instance just changed state, so at least one exists.
    if (instances.length > 0) {
      messagingService.sendToAll('server-instances', instances);
    }
  } catch (error) {
    console.error('[instance-events] Could not broadcast the instance list:', error);
  }
}

function startPolling(instanceId: string): void {
  serverMonitoringService.startMemoryPolling(instanceId, (id, memory) => {
    messagingService.sendToAll('server-instance-memory', { instanceId: id, memory });
  });
  serverMonitoringService.startPlayerPolling(instanceId, (id, count) => {
    // The renderer reads `players`; `count` is kept for anything already listening to it.
    messagingService.sendToAll('server-instance-players', { instanceId: id, players: count, count });
  });
  serverMonitoringService.startCpuPolling(instanceId, (id, cpu) => {
    messagingService.sendToAll('server-instance-cpu', { instanceId: id, cpu });
  });
}

function stopPolling(instanceId: string): void {
  serverMonitoringService.stopMemoryPolling(instanceId);
  serverMonitoringService.stopPlayerPolling(instanceId);
  serverMonitoringService.stopCpuPolling(instanceId);
}
