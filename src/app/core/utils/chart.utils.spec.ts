import { toPoints, linePath, areaPath, bucketSamples, seriesStats, PlayerHistorySample } from './chart.utils';

describe('chart.utils', () => {
  it('maps values into the svg box with the highest value at the top', () => {
    const points = toPoints([0, 5, 10], 100, 50);
    expect(points.length).toBe(3);
    expect(points[0]).toEqual({ x: 0, y: 50 });
    expect(points[2]).toEqual({ x: 100, y: 0 });
    expect(points[1].y).toBe(25);
  });

  it('centres a single value and respects padding', () => {
    const points = toPoints([3], 100, 50, 6, 5);
    expect(points[0].x).toBe(50);
    expect(points[0].y).toBe(25);
  });

  it('builds line and area paths', () => {
    const points = toPoints([1, 2], 10, 10, 2);
    expect(linePath(points)).toBe('M0 5 L10 0');
    expect(areaPath(points, 10)).toBe('M0 5 L10 0 L10 10 L0 10 Z');
    expect(linePath([])).toBe('');
    expect(areaPath([], 10)).toBe('');
  });

  it('buckets samples into a fixed window using the peak per bucket', () => {
    const now = 100_000;
    const samples: PlayerHistorySample[] = [
      { t: now - 9_500, counts: { a: 1, b: 2 } },
      { t: now - 9_000, counts: { a: 4, b: 0 } },
      { t: now - 500, counts: { a: 2 } },
      { t: now - 20_000, counts: { a: 99 } } // outside window
    ];
    const total = bucketSamples(samples, 10_000, 1_000, now);
    expect(total.length).toBe(10);
    expect(total[0].value).toBe(3);
    expect(total[1].value).toBe(4);
    expect(total[9].value).toBe(2);
    expect(total[5].value).toBe(0);

    const onlyB = bucketSamples(samples, 10_000, 1_000, now, 'b');
    expect(onlyB[0].value).toBe(2);
    expect(onlyB[9].value).toBe(0);
  });

  it('tolerates malformed samples', () => {
    const points = bucketSamples([null as any, { t: 'x' as any, counts: {} }, { t: Date.now(), counts: null as any }], 1000, 500);
    expect(points.every(p => p.value === 0)).toBeTrue();
  });

  it('computes peak and average', () => {
    expect(seriesStats([{ t: 0, value: 2 }, { t: 1, value: 6 }, { t: 2, value: 1 }])).toEqual({ peak: 6, average: 3 });
    expect(seriesStats([])).toEqual({ peak: 0, average: 0 });
  });
});
