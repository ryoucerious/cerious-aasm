import { PlayerHistoryService, playerHistoryService } from '../services/player-history.service';
import { identifySender } from '../services/auth/permission-gate';
import { visibleInstanceIds } from '../services/auth/pool-access';
import { getAllInstances } from '../utils/ark/instance.utils';
import { onRequest } from './handler.utils';

onRequest('get-player-history', async (_payload, { sender }) => {
  let samples = playerHistoryService.getSamples();
  const identity = identifySender(sender);
  if (!identity.isAdmin) {
    // The chart adds up the counts it is given, so a pool member's chart must only hold their servers.
    const visible = visibleInstanceIds(identity.user, await getAllInstances());
    if (visible !== null) {
      samples = samples.map(sample => ({
        t: sample.t,
        counts: Object.fromEntries(Object.entries(sample.counts).filter(([id]) => visible.has(id)))
      }));
    }
  }
  return { samples, intervalMs: PlayerHistoryService.SAMPLE_INTERVAL_MS };
}, { onError: error => ({ error, samples: [] }) });
