import { RestartCountdownService, type CountdownDeps } from './restart-countdown.service';

describe('RestartCountdownService', () => {
  const MINUTE = 60_000;
  let deps: jest.Mocked<CountdownDeps>;
  let running: Set<string>;
  let countdowns: RestartCountdownService;

  beforeEach(() => {
    jest.useFakeTimers({ now: 1_000_000 });
    running = new Set(['a', 'b']);
    deps = {
      broadcast: jest.fn(async () => true),
      isRunning: jest.fn((id: string) => running.has(id)),
      publish: jest.fn(),
      now: jest.fn(() => Date.now())
    };
    countdowns = new RestartCountdownService(deps);
  });

  afterEach(() => jest.useRealTimers());

  const said = (id: string) => deps.broadcast.mock.calls.filter(([server]) => server === id).map(([, message]) => message);

  it('warns the players at each mark, then restarts when the time is up', async () => {
    const restart = jest.fn(async () => undefined);

    const dueAt = countdowns.begin(['a'], 5, false, restart);

    expect(dueAt).toBe(1_000_000 + 5 * MINUTE);
    expect(said('a')).toEqual(['Server will restart in 5 minutes!']);
    await jest.advanceTimersByTimeAsync(4 * MINUTE);
    expect(said('a')).toEqual([
      'Server will restart in 5 minutes!', 'Server will restart in 4 minutes!', 'Server will restart in 3 minutes!',
      'Server will restart in 2 minutes!', 'Server will restart in 1 minute!'
    ]);
    expect(restart).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(MINUTE);

    expect(said('a').at(-1)).toBe('Server restarting now!');
    expect(restart).toHaveBeenCalledWith(['a']);
  });

  it('counts down 15 minutes as 15, 10, 5, 4, 3, 2, 1', async () => {
    countdowns.begin(['a'], 15, false, async () => undefined);
    await jest.advanceTimersByTimeAsync(15 * MINUTE);

    expect(said('a').map(message => message.match(/\d+/)?.[0] ?? 'now')).toEqual(['15', '10', '5', '4', '3', '2', '1', 'now']);
  });

  it('tells the app when each server will restart, and when it no longer will', async () => {
    countdowns.begin(['a', 'b'], 1, true, async () => undefined);

    expect(deps.publish).toHaveBeenCalledWith({ instanceId: 'a', dueAt: 1_000_000 + MINUTE, all: true });
    expect(countdowns.pending()).toEqual([
      { instanceId: 'a', dueAt: 1_000_000 + MINUTE, all: true },
      { instanceId: 'b', dueAt: 1_000_000 + MINUTE, all: true }
    ]);

    await jest.advanceTimersByTimeAsync(MINUTE);

    expect(deps.publish).toHaveBeenCalledWith({ instanceId: 'a', dueAt: null, all: true });
    expect(countdowns.pending()).toEqual([]);
  });

  // Someone stopped it meanwhile: that was meant.
  it('leaves out a server that is no longer running when the time is up', async () => {
    const restart = jest.fn(async () => undefined);
    countdowns.begin(['a', 'b'], 1, true, restart);
    running.delete('b');

    await jest.advanceTimersByTimeAsync(MINUTE);

    expect(restart).toHaveBeenCalledWith(['a']);
    expect(said('b')).toEqual(['Server will restart in 1 minute!']);
  });

  it('can be cancelled: the players are told, and nothing restarts', async () => {
    const restart = jest.fn(async () => undefined);
    countdowns.begin(['a'], 5, false, restart);

    expect(countdowns.cancel('a')).toBe(true);
    await jest.advanceTimersByTimeAsync(10 * MINUTE);

    expect(said('a').at(-1)).toBe('The restart was cancelled.');
    expect(restart).not.toHaveBeenCalled();
    expect(deps.publish).toHaveBeenLastCalledWith({ instanceId: 'a', dueAt: null, all: false });
    expect(countdowns.cancel('a')).toBe(false);
  });

  it('cancels one server of a restart of all, and restarts the rest', async () => {
    const restart = jest.fn(async () => undefined);
    countdowns.begin(['a', 'b'], 1, true, restart);

    countdowns.cancel('b');
    await jest.advanceTimersByTimeAsync(MINUTE);

    expect(restart).toHaveBeenCalledWith(['a']);
  });

  it('cancels a restart of all, leaving a server\'s own restart alone', async () => {
    const own = jest.fn(async () => undefined);
    const all = jest.fn(async () => undefined);
    running.add('c');
    countdowns.begin(['c'], 5, false, own);
    countdowns.begin(['a', 'b'], 5, true, all);

    expect(countdowns.cancelAll().sort()).toEqual(['a', 'b']);
    await jest.advanceTimersByTimeAsync(5 * MINUTE);

    expect(all).not.toHaveBeenCalled();
    expect(own).toHaveBeenCalledWith(['c']);
  });

  // Asked again, or swept into a restart of all: one countdown per server.
  it('moves a server already counting down onto the new countdown', async () => {
    const first = jest.fn(async () => undefined);
    const second = jest.fn(async () => undefined);
    countdowns.begin(['a'], 15, false, first);

    countdowns.begin(['a', 'b'], 1, true, second);
    await jest.advanceTimersByTimeAsync(15 * MINUTE);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(['a', 'b']);
  });

  it('does not wait on a warning that is slow or fails', async () => {
    deps.broadcast.mockImplementation(() => new Promise(() => undefined));
    const restart = jest.fn(async () => undefined);
    countdowns.begin(['a'], 1, false, restart);

    await jest.advanceTimersByTimeAsync(MINUTE);

    expect(restart).toHaveBeenCalledWith(['a']);
  });
});
