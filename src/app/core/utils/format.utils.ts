/**
 * Small display formatters shared by the dashboard, server cards and top bar.
 * Pure functions, no Angular dependencies, so they are trivial to unit test.
 */

/** "3d 14h", "1d 6h", "5h 23m", "12m", "45s" — the compact style used on server cards. */
export function formatUptime(startedAt: number | null | undefined, now: number = Date.now()): string {
  if (!startedAt || startedAt > now) return '--';
  const totalSeconds = Math.floor((now - startedAt) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

/** "just now", "2 minutes ago", "1 hour ago", "3 days ago". */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** Bytes to a short human size: "84 GB", "13.4 GB", "512 MB". */
export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? Math.round(value) : Number(value.toFixed(value >= 100 ? 0 : decimals));
  return `${rounded} ${units[unit]}`;
}

/** Megabytes (what the backend reports for a server process) to "6.2 GB" or "512 MB". */
export function formatMegabytes(megabytes: number | null | undefined): string {
  if (megabytes === null || megabytes === undefined || !Number.isFinite(megabytes)) return '--';
  return formatBytes(megabytes * 1024 * 1024);
}

/** Percentage to a whole-number label, "--" when unknown. */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return `${Math.round(value)}%`;
}

/** Clamp a ratio into the 0-100 range for progress bars. */
export function toPercent(used: number | null | undefined, total: number | null | undefined): number {
  if (!used || !total || total <= 0) return 0;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

/** "12am", "3am", "12pm", "9pm" for chart axes. */
export function formatHourLabel(timestamp: number): string {
  const hours = new Date(timestamp).getHours();
  const suffix = hours >= 12 ? 'pm' : 'am';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}${suffix}`;
}

/** First letter of a name for an avatar, uppercase. */
export function initialOf(name: string | null | undefined): string {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}
