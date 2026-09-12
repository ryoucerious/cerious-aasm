/**
 * Geometry helpers for the hand-drawn SVG charts on the dashboard. There is no charting
 * library in this project, and the charts are simple enough (an area line and a bar row)
 * that a few path builders keep the bundle small and the styling fully token-driven.
 */

export interface ChartPoint {
  x: number;
  y: number;
}

/** A single reading from the backend's player-history buffer. */
export interface PlayerHistorySample {
  t: number;
  counts: Record<string, number>;
}

/** One plotted point after bucketing: the bucket start time and the value for that bucket. */
export interface SeriesPoint {
  t: number;
  value: number;
}

/**
 * Map values onto an SVG box. `values` are plotted left to right; the y-axis is scaled to
 * `maxValue` (at least 1 so a flat zero line still sits at the bottom instead of dividing by zero).
 */
export function toPoints(values: number[], width: number, height: number, maxValue?: number, padding = 0): ChartPoint[] {
  if (!values.length) return [];
  const max = Math.max(1, maxValue ?? Math.max(...values));
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);
  const step = values.length > 1 ? innerWidth / (values.length - 1) : 0;
  return values.map((value, index) => ({
    x: padding + (values.length > 1 ? index * step : innerWidth / 2),
    y: padding + innerHeight - (Math.max(0, value) / max) * innerHeight
  }));
}

/** Straight-segment polyline path ("M x y L x y ..."). Empty string for no points. */
export function linePath(points: ChartPoint[]): string {
  if (!points.length) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ');
}

/** Closed path under the line down to the baseline, for the translucent fill. */
export function areaPath(points: ChartPoint[], height: number, padding = 0): string {
  if (!points.length) return '';
  const first = points[0];
  const last = points[points.length - 1];
  const baseline = round(height - padding);
  return `${linePath(points)} L${round(last.x)} ${baseline} L${round(first.x)} ${baseline} Z`;
}

/**
 * Reduce raw one-minute samples into fixed-width buckets over a trailing window. Each bucket
 * holds the maximum total across its samples (a peak is more useful than an average when
 * deciding whether a server was busy). Buckets with no samples carry 0 so gaps read as
 * "nobody was on" rather than pulling the line off the chart.
 *
 * Pass `instanceId` to plot a single server, or omit it for the sum of every server.
 */
export function bucketSamples(
  samples: PlayerHistorySample[],
  windowMs: number,
  bucketMs: number,
  now: number = Date.now(),
  instanceId?: string
): SeriesPoint[] {
  const bucketCount = Math.max(1, Math.round(windowMs / bucketMs));
  const start = now - windowMs;
  const buckets: SeriesPoint[] = Array.from({ length: bucketCount }, (_, i) => ({ t: start + i * bucketMs, value: 0 }));
  for (const sample of samples || []) {
    if (!sample || typeof sample.t !== 'number' || sample.t < start || sample.t > now) continue;
    const index = Math.min(bucketCount - 1, Math.floor((sample.t - start) / bucketMs));
    const value = instanceId
      ? Number(sample.counts?.[instanceId] || 0)
      : Object.values(sample.counts || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    buckets[index].value = Math.max(buckets[index].value, value);
  }
  return buckets;
}

/** Peak and mean of a series, ignoring nothing — zeros count, because empty hours are real. */
export function seriesStats(points: SeriesPoint[]): { peak: number; average: number } {
  if (!points.length) return { peak: 0, average: 0 };
  const values = points.map(p => p.value);
  const peak = Math.max(...values);
  const average = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return { peak, average };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
