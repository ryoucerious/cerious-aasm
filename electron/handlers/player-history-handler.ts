import { PlayerHistoryService, playerHistoryService } from '../services/player-history.service';
import { onRequest } from './handler.utils';

onRequest('get-player-history', () => ({
  samples: playerHistoryService.getSamples(),
  intervalMs: PlayerHistoryService.SAMPLE_INTERVAL_MS
}), { onError: error => ({ error, samples: [] }) });
