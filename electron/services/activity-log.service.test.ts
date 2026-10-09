import { ActivityLogService } from './activity-log.service';
import { userDatabaseService } from './auth/user-database.service';

jest.mock('./auth/user-database.service', () => ({
  userDatabaseService: { recordActivity: jest.fn(), listActivity: jest.fn(), clearActivity: jest.fn() }
}));
jest.mock('./messaging.service', () => ({ messagingService: { setObserver: jest.fn() } }));

const recordActivity = jest.mocked(userDatabaseService.recordActivity);

describe('ActivityLogService', () => {
  let service: ActivityLogService;

  beforeEach(() => {
    service = new ActivityLogService();
    service.noteInstanceNames([{ id: 'a1', name: 'Ragnarok' }]);
  });

  const state = (value: string) => service.recordFromBroadcast('server-instance-state', { instanceId: 'a1', state: value });
  const players = (count: number) => service.recordFromBroadcast('server-instance-players', { instanceId: 'a1', players: count, count });
  const recorded = () => recordActivity.mock.calls.map(([entry]) => `${entry.kind}: ${entry.message}`);

  it('records state changes once each', () => {
    state('starting');
    state('running');
    state('running');
    state('stopping');
    state('stopped');

    expect(recorded()).toEqual(['start: Ragnarok started', 'stop: Ragnarok stopped']);
  });

  it('turns changes in the player count into joins and leaves', () => {
    state('running');
    players(0);
    players(2);
    players(1);

    expect(recorded()).toEqual([
      'start: Ragnarok started',
      'join: 2 players joined (Ragnarok)',
      'leave: Player left (Ragnarok)'
    ]);
  });

  // The count from before a stop used to be compared with the first reading after the restart.
  it('does not report the players of the last run as leaving after a restart', () => {
    state('running');
    players(0);
    players(5);
    state('stopping');
    state('stopped');
    state('starting');
    state('running');
    players(0);

    expect(recorded()).not.toContainEqual(expect.stringMatching(/^leave:/));
  });

  it('does not report the players of a crashed run as leaving after a restart', () => {
    state('starting');
    state('running');
    players(3);
    state('crashed');
    state('starting');
    state('running');
    players(1);

    expect(recorded().filter(line => /^(join|leave):/.test(line))).toEqual([
      'join: 3 players joined (Ragnarok)',
      'join: Player joined (Ragnarok)'
    ]);
  });

  it('counts players who joined before the first reading after a start', () => {
    state('starting');
    state('running');
    players(2);

    expect(recorded()).toContain('join: 2 players joined (Ragnarok)');
  });

  // A stop can be undone (the server keeps running), and its players never left.
  it('keeps the count through a stop that did not happen', () => {
    state('starting');
    state('running');
    players(5);
    state('stopping');
    state('running');
    players(5);

    expect(recorded().filter(line => /^(join|leave):/.test(line))).toEqual(['join: 5 players joined (Ragnarok)']);
  });

  it('keeps the count when the same state is broadcast again', () => {
    state('starting');
    state('running');
    players(3);
    state('running');
    players(3);

    expect(recorded().filter(line => line.startsWith('join:'))).toEqual(['join: 3 players joined (Ragnarok)']);
  });

  it('takes the first reading after the app starts as the baseline', () => {
    players(4);
    players(4);

    expect(recorded()).toEqual([]);
  });

  // ARK under Proton took 5 minutes to start, and ignored DoExit for 2: both outcomes lost the name.
  describe('crediting a slow start or stop', () => {
    const credited = () => recordActivity.mock.calls.map(([entry]) => `${entry.message} by ${entry.username}`);

    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-09T02:00:00Z') }));
    afterEach(() => jest.useRealTimers());

    it('credits the outcome to whoever asked, however long it takes', () => {
      service.noteAction('start-server-instance', { id: 'a1' }, 'ann');
      state('starting');
      jest.setSystemTime(Date.now() + 5 * 60_000);
      state('running');
      service.noteAction('stop-server-instance', { id: 'a1' }, 'bob');
      state('stopping');
      jest.setSystemTime(Date.now() + 5 * 60_000);
      state('stopped');

      expect(credited()).toEqual(['Ragnarok started by ann', 'Ragnarok stopped by bob']);
    });

    // Start All queues the servers, the start delay apart: the last can wait minutes to begin.
    it('credits a server Start All queued, when its turn comes', () => {
      service.noteAction('start-all-instances', {}, 'ann');
      state('queued');
      jest.setSystemTime(Date.now() + 4 * 60_000);
      state('starting');
      jest.setSystemTime(Date.now() + 5 * 60_000);
      state('running');

      expect(credited()).toEqual(['Ragnarok started by ann']);
    });

    it('credits nobody with a later change nobody asked for', () => {
      service.noteAction('start-server-instance', { id: 'a1' }, 'ann');
      state('starting');
      state('running');
      jest.setSystemTime(Date.now() + 60 * 60_000);
      state('stopping');
      state('stopped');

      expect(credited()).toEqual(['Ragnarok started by ann', 'Ragnarok stopped by null']);
    });

    it('credits nobody with a crash part way through', () => {
      service.noteAction('start-server-instance', { id: 'a1' }, 'ann');
      state('starting');
      jest.setSystemTime(Date.now() + 5 * 60_000);
      state('crashed');
      jest.setSystemTime(Date.now() + 5 * 60_000);
      state('starting');
      state('running');

      expect(credited()).toEqual(['Ragnarok crashed by null', 'Ragnarok started by null']);
    });
  });
});
