import { messagingService } from '../services/messaging.service';
import { playerHistoryService } from '../services/player-history.service';
import { identifySender } from '../services/auth/permission-gate';
import { getAllInstances } from '../utils/ark/instance.utils';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/player-history.service', () => ({
  PlayerHistoryService: { SAMPLE_INTERVAL_MS: 60_000 },
  playerHistoryService: { getSamples: jest.fn() }
}));

jest.mock('../services/auth/permission-gate', () => ({ identifySender: jest.fn() }));
jest.mock('../utils/ark/instance.utils', () => ({ getAllInstances: jest.fn() }));

const mockMessaging = jest.mocked(messagingService);
const mockHistory = jest.mocked(playerHistoryService);
const mockIdentify = jest.mocked(identifySender);
const mockGetAllInstances = jest.mocked(getAllInstances);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('player-history-handler', () => {
  const sender = { send: jest.fn() };
  let handler: Listener;

  beforeAll(() => {
    require('./player-history-handler');
    handler = mockMessaging.on.mock.calls.find(([channel]) => channel === 'get-player-history')![1] as Listener;
  });

  beforeEach(() => {
    mockIdentify.mockReturnValue({ user: null, permissions: [], isAdmin: true, isLocalDesktop: true });
    mockGetAllInstances.mockResolvedValue([]);
  });

  it('drops the counts of servers a pool member may not see', async () => {
    mockIdentify.mockReturnValue({
      user: { id: 'op1', username: 'op1', displayName: 'op1', roleId: 'operator', roleName: 'Operator', ownerUserId: null, active: true, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null, permissions: [] },
      permissions: [], isAdmin: false, isLocalDesktop: false
    });
    mockGetAllInstances.mockResolvedValue([{ id: 'a', operatorUserId: 'op1' }, { id: 'b', operatorUserId: null }] as never);
    mockHistory.getSamples.mockReturnValue([{ t: 1, counts: { a: 2, b: 5 } }]);

    await handler({ requestId: 'r1' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-player-history', { samples: [{ t: 1, counts: { a: 2 } }], intervalMs: 60_000, requestId: 'r1' }, sender);
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
