import { computeNextRun, parseTimeOfDay } from './schedule.utils';

// Monday 29 September 2025, 10:00 host local time.
const now = new Date(2025, 8, 29, 10, 0, 0);
const MONDAY = 1;
const WEDNESDAY = 3;

describe('schedule.utils', () => {
  describe('computeNextRun', () => {
    it('runs hourly an hour from now', () => {
      expect(computeNextRun({ frequency: 'hourly' }, now)).toEqual(new Date(2025, 8, 29, 11, 0, 0));
    });

    it('runs daily later today when the time is still ahead', () => {
      expect(computeNextRun({ frequency: 'daily', time: '22:30' }, now)).toEqual(new Date(2025, 8, 29, 22, 30));
    });

    it.each(['09:59', '10:00'])('runs daily tomorrow once %s has come', time => {
      const [hours, minutes] = time.split(':').map(Number);
      expect(computeNextRun({ frequency: 'daily', time }, now)).toEqual(new Date(2025, 8, 30, hours, minutes));
    });

    it('runs weekly on the nearest of the chosen days', () => {
      expect(computeNextRun({ frequency: 'weekly', time: '04:00', days: [MONDAY, WEDNESDAY] }, now))
        .toEqual(new Date(2025, 9, 1, 4, 0));
    });

    it('runs weekly later today when today is chosen and the time is ahead', () => {
      expect(computeNextRun({ frequency: 'weekly', time: '12:00', days: [MONDAY] }, now)).toEqual(new Date(2025, 8, 29, 12, 0));
    });

    it('runs weekly a week on when today\'s time has passed', () => {
      expect(computeNextRun({ frequency: 'weekly', time: '04:00', days: [MONDAY] }, now)).toEqual(new Date(2025, 9, 6, 4, 0));
    });

    it('ignores weekdays that do not exist', () => {
      expect(computeNextRun({ frequency: 'weekly', time: '04:00', days: [7, -1, 2.5, '7', '2.5', 'tuesday', '', WEDNESDAY] }, now))
        .toEqual(new Date(2025, 9, 1, 4, 0));
    });

    it('takes weekdays sent as numeric strings, as a form select sends them', () => {
      expect(computeNextRun({ frequency: 'weekly', time: '04:00', days: ['3'] }, now)).toEqual(new Date(2025, 9, 1, 4, 0));
      expect(computeNextRun({ frequency: 'weekly', time: '04:00', days: ['0'] }, now)).toEqual(new Date(2025, 9, 5, 4, 0));
    });

    // Each of these used to schedule a delay of zero or less, or NaN, and so a restart or backup
    // that fired again at once, in a loop.
    it.each([
      ['no restart', { frequency: 'none', time: '04:00' }],
      ['an unknown frequency', { frequency: 'custom', time: '04:00', days: [MONDAY] }],
      ['no frequency', { time: '04:00' }],
      ['weekly with no days', { frequency: 'weekly', time: '04:00', days: [] }],
      ['weekly with no valid days', { frequency: 'weekly', time: '04:00', days: [8, 'monday'] }],
      ['weekly with days missing', { frequency: 'weekly', time: '04:00' }],
      ['an impossible time', { frequency: 'daily', time: '25:99' }],
      ['a time that is not HH:MM', { frequency: 'daily', time: '4' }],
      ['no time', { frequency: 'daily' }],
      ['a weekly impossible time', { frequency: 'weekly', time: '12:60', days: [MONDAY] }]
    ])('has no next run for %s', (_label, settings) => {
      expect(computeNextRun(settings, now)).toBeNull();
    });

    it('never returns a time at or before now', () => {
      for (let minute = 0; minute < 24 * 60; minute += 7) {
        const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
        for (const settings of [{ frequency: 'daily', time }, { frequency: 'weekly', time, days: [0, 1, 2, 3, 4, 5, 6] }]) {
          expect(computeNextRun(settings, now)!.getTime()).toBeGreaterThan(now.getTime());
        }
      }
    });
  });

  describe('parseTimeOfDay', () => {
    it.each([
      ['00:00', { hours: 0, minutes: 0 }],
      ['4:05', { hours: 4, minutes: 5 }],
      [' 23:59 ', { hours: 23, minutes: 59 }]
    ])('reads %p', (time, expected) => {
      expect(parseTimeOfDay(time)).toEqual(expected);
    });

    it.each(['24:00', '12:60', '25:99', '12', '12:5', 'ab:cd', '', null, undefined, 1200, {}])('rejects %p', time => {
      expect(parseTimeOfDay(time)).toBeNull();
    });
  });
});
