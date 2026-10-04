import { messagingService } from '../services/messaging.service';
import { playerHistoryService } from '../services/player-history.service';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/player-history.service', () => ({
  PlayerHistoryService: { SAMPLE_INTERVAL_MS: 60_000 },
  playerHistoryService: { getSamples: jest.fn() }
}));

const mockMessaging = jest.mocked(messagingService);
const mockHistory = jest.mocked(playerHistoryService);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('player-history-handler', () => {
  const sender = { send: jest.fn() };
  let handler: Listener;

  beforeAll(() => {
    require('./player-history-handler');
    handler = mockMessaging.on.mock.calls.find(([channel]) => channel === 'get-player-history')![1] as Listener;
  });

  it('replies with the recorded samples and the sampling interval', async () => {
    const samples = [{ t: 1, counts: { a: 2 } }];
    mockHistory.getSamples.mockReturnValue(samples);

    await handler({ requestId: 'r1' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-player-history', { samples, intervalMs: 60_000, requestId: 'r1' }, sender);
  });

  it('replies an empty list with the reason reading fails', async () => {
    mockHistory.getSamples.mockImplementation(() => { throw new Error('boom'); });

    await handler({ requestId: 'r2' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-player-history', { error: 'boom', samples: [], requestId: 'r2' }, sender);
  });

  it('answers a request without a payload', async () => {
    mockHistory.getSamples.mockReturnValue([]);

    await handler(undefined, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-player-history', { samples: [], intervalMs: 60_000, requestId: undefined }, sender);
  });
});
