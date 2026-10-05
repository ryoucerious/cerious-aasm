import type { ActivityKind } from '../services/activity.service';

/** Material icon and colour tone for each kind of activity entry. */
export const ACTIVITY_ICONS: Record<ActivityKind, { icon: string; tone: string }> = {
  start:   { icon: 'play_arrow',      tone: 'success' },
  stop:    { icon: 'stop',            tone: 'danger' },
  crash:   { icon: 'error',           tone: 'danger' },
  backup:  { icon: 'backup',          tone: 'primary' },
  join:    { icon: 'person_add',      tone: 'info' },
  leave:   { icon: 'person_remove',   tone: 'muted' },
  update:  { icon: 'system_update',   tone: 'warning' },
  error:   { icon: 'warning',         tone: 'danger' },
  info:    { icon: 'info',            tone: 'info' },
  account: { icon: 'manage_accounts', tone: 'violet' }
};
