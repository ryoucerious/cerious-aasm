import { messagingService } from '../services/messaging.service';
import { playerHistoryService } from '../services/player-history.service';
import { identifySender } from '../services/auth/permission-gate';
import { filterInstancesForUser, isServerScoped } from '../services/auth/server-assignment';
import { getAllInstances } from '../utils/ark/instance.utils';

/**
 * Handles 'get-player-history': the last 24 hours of per-instance player counts, sampled once
 * a minute by PlayerHistoryService. Feeds the dashboard's Player Activity chart and the
 * sparkline on each server card.
 */
messagingService.on('get-player-history', async (payload: any, sender: any) => {
  const { requestId } = payload || {};
  try {
    const identity = identifySender(sender);
    let samples = playerHistoryService.getSamples();
    if (isServerScoped(identity) && identity.user) {
      const allowed = new Set(filterInstancesForUser(identity.user, await getAllInstances()).map((instance: any) => instance.id));
      samples = samples.map(sample => ({
        t: sample.t,
        counts: Object.fromEntries(Object.entries(sample.counts || {}).filter(([id]) => allowed.has(id)))
      }));
    }
    messagingService.sendToOriginator('get-player-history', {
      samples,
      intervalMs: 60 * 1000,
      requestId
    }, sender);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[player-history-handler] Failed to read player history:', errMsg);
    messagingService.sendToOriginator('get-player-history', { error: errMsg, samples: [], requestId }, sender);
  }
});
