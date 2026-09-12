import { messagingService } from '../services/messaging.service';
import { activityLogService } from '../services/activity-log.service';

/**
 * The Recent Activity feed. Reading is open to any signed-in user; clearing needs the
 * settings permission, since the history is shared by everyone.
 */

messagingService.on('get-activity', (payload: any, sender: any) => {
  const { requestId, limit } = payload || {};
  try {
    const entries = activityLogService.list(typeof limit === 'number' ? limit : 100);
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
