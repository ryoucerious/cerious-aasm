import { messagingService } from '../services/messaging.service';
import { playerHistoryService } from '../services/player-history.service';

/**
 * Handles 'get-player-history': the last 24 hours of per-instance player counts, sampled once
 * a minute by PlayerHistoryService. Feeds the dashboard's Player Activity chart and the
 * sparkline on each server card.
 */
messagingService.on('get-player-history', (payload: any, sender: any) => {
  const { requestId } = payload || {};
  try {
    messagingService.sendToOriginator('get-player-history', {
      samples: playerHistoryService.getSamples(),
      intervalMs: 60 * 1000,
      requestId
    }, sender);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[player-history-handler] Failed to read player history:', errMsg);
    messagingService.sendToOriginator('get-player-history', { error: errMsg, samples: [], requestId }, sender);
  }
});
