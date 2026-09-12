import { formatUptime, formatRelativeTime, formatBytes, formatMegabytes, formatPercent, toPercent, formatHourLabel, initialOf } from './format.utils';

describe('format.utils', () => {
  const now = 1_700_000_000_000;

  it('formats uptime in the compact card style', () => {
    expect(formatUptime(now - 45_000, now)).toBe('45s');
    expect(formatUptime(now - 12 * 60_000, now)).toBe('12m');
    expect(formatUptime(now - (5 * 3600 + 23 * 60) * 1000, now)).toBe('5h 23m');
    expect(formatUptime(now - (3 * 86400 + 14 * 3600) * 1000, now)).toBe('3d 14h');
    expect(formatUptime(null, now)).toBe('--');
    expect(formatUptime(now + 1000, now)).toBe('--');
  });

  it('formats relative time', () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 2 * 60_000, now)).toBe('2 minutes ago');
    expect(formatRelativeTime(now - 60 * 60_000, now)).toBe('1 hour ago');
    expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe('3 days ago');
  });

  it('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(84 * 1024 ** 3, 0)).toBe('84 GB');
    expect(formatBytes(13.4 * 1024 ** 3)).toBe('13.4 GB');
    expect(formatBytes(null)).toBe('--');
    expect(formatMegabytes(6348.8)).toBe('6.2 GB');
    expect(formatMegabytes(undefined)).toBe('--');
  });

  it('formats percentages and ratios', () => {
    expect(formatPercent(17.6)).toBe('18%');
    expect(formatPercent(null)).toBe('--');
    expect(toPercent(50, 200)).toBe(25);
    expect(toPercent(500, 200)).toBe(100);
    expect(toPercent(0, 0)).toBe(0);
  });

  it('formats hour labels and initials', () => {
    const noon = new Date(2024, 0, 1, 12, 0).getTime();
    const midnight = new Date(2024, 0, 1, 0, 0).getTime();
    const nine = new Date(2024, 0, 1, 21, 0).getTime();
    expect(formatHourLabel(noon)).toBe('12pm');
    expect(formatHourLabel(midnight)).toBe('12am');
    expect(formatHourLabel(nine)).toBe('9pm');
    expect(initialOf('jared')).toBe('J');
    expect(initialOf('')).toBe('?');
  });
});
