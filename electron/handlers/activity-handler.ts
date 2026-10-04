import { messagingService } from '../services/messaging.service';
import { activityLogService } from '../services/activity-log.service';
import { onRequest } from './handler.utils';

const DEFAULT_LIMIT = 100;

onRequest('get-activity', payload => {
  const limit = typeof payload.limit === 'number' ? payload.limit : DEFAULT_LIMIT;
  return { success: true, entries: activityLogService.list(limit) };
}, { onError: error => ({ success: false, error, entries: [] }) });

onRequest('clear-activity', (_payload, { afterReply }) => {
  // Clearing the feed leaves it empty: an entry saying it was cleared is the one thing
  // nobody asked to keep.
  activityLogService.clear();
  afterReply(() => messagingService.sendToAll('activity-changed', {}));
  return { success: true };
});
