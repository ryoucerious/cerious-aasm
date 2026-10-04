import { messagingService } from '../services/messaging.service';
import { activityLogService } from '../services/activity-log.service';
import { identifySender } from '../services/auth/permission-gate';
import { filterInstancesForUser } from '../services/auth/server-assignment';
import { getAllInstances } from '../utils/ark/instance.utils';

/**
 * The Recent Activity feed. An admin sees every entry. Everyone else only sees entries
 * for servers in their group, so one operator's feed cannot name another group's servers.
 * Clearing needs the settings permission, since the history is shared.
 */

messagingService.on('get-activity', async (payload: any, sender: any) => {
  const { requestId, limit } = payload || {};
  try {
    let entries = activityLogService.list(typeof limit === 'number' ? limit : 100);
    const identity = identifySender(sender);
    if (!identity.isAdmin) {
      const allowed = new Set(filterInstancesForUser(identity.user, await getAllInstances()).map((instance: any) => instance.id));
      entries = entries.filter(entry => !!entry.instanceId && allowed.has(entry.instanceId));
    }
    messagingService.sendToOriginator('get-activity', { success: true, entries, requestId }, sender);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[activity-handler] Failed to read activity:', message);
    messagingService.sendToOriginator('get-activity', { success: false, error: message, entries: [], requestId }, sender);
  }
});

messagingService.on('clear-activity', (payload: any, sender: any) => {
  const { requestId } = payload || {};
  try {
    // Clearing the feed leaves it empty: an entry saying it was cleared is the one thing
    // nobody asked to keep.
    activityLogService.clear();
    messagingService.sendToOriginator('clear-activity', { success: true, requestId }, sender);
    messagingService.sendToAll('activity-changed', {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[activity-handler] Failed to clear activity:', message);
    messagingService.sendToOriginator('clear-activity', { success: false, error: message, requestId }, sender);
  }
});
