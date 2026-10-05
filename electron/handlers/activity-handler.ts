import { messagingService } from '../services/messaging.service';
import { activityLogService } from '../services/activity-log.service';
import { identifySender } from '../services/auth/permission-gate';
import { visibleInstanceIds } from '../services/auth/pool-access';
import { getAllInstances } from '../utils/ark/instance.utils';
import { onRequest } from './handler.utils';

const DEFAULT_LIMIT = 100;

onRequest('get-activity', async (payload, { sender }) => {
  const limit = typeof payload.limit === 'number' ? payload.limit : DEFAULT_LIMIT;
  const entries = activityLogService.list(limit);
  const identity = identifySender(sender);
  if (identity.isAdmin) return { success: true, entries };

  // A pool member sees what happened to their servers. Entries about no server in particular
  // (the web server starting, the feed being cleared) are the admin's business.
  const visible = visibleInstanceIds(identity.user, await getAllInstances());
  return {
    success: true,
    entries: entries.filter(entry => !!entry.instanceId && (visible === null || visible.has(entry.instanceId)))
  };
}, { onError: error => ({ success: false, error, entries: [] }) });

onRequest('clear-activity', (_payload, { afterReply }) => {
  // Clearing the feed leaves it empty: an entry saying it was cleared is the one thing
  // nobody asked to keep.
  activityLogService.clear();
  afterReply(() => messagingService.sendToAll('activity-changed', {}));
  return { success: true };
});
