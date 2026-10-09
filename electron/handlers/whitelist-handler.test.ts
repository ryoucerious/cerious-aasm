import { messagingService } from '../services/messaging.service';
import { whitelistService } from '../services/whitelist.service';
import { setHostRouter } from '../services/host-routing';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/whitelist.service', () => ({
  whitelistService: {
    loadWhitelistFromInstance: jest.fn(),
    addToInstanceWhitelist: jest.fn(),
    removeFromInstanceWhitelist: jest.fn(),
    clearInstanceWhitelist: jest.fn()
  }
}));

const mockMessaging = jest.mocked(messagingService);
const mockWhitelist = jest.mocked(whitelistService);

type Listener = (payload: unknown, sender: unknown) => Promise<void> | void;

describe('whitelist-handler', () => {
  const sender = { send: jest.fn() };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./whitelist-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  function replies(channel: string): unknown[] {
    return mockMessaging.sendToOriginator.mock.calls.filter(([replyChannel]) => replyChannel === channel).map(call => call[1]);
  }

  describe.each([
    ['load-whitelist', mockWhitelist.loadWhitelistFromInstance, false, 'Instance ID is required', 'Failed to load whitelist'],
    ['add-to-whitelist', mockWhitelist.addToInstanceWhitelist, true, 'Instance ID and Player ID are required', 'Failed to add player to whitelist'],
    ['remove-from-whitelist', mockWhitelist.removeFromInstanceWhitelist, true, 'Instance ID and Player ID are required', 'Failed to remove player from whitelist'],
    ['clear-whitelist', mockWhitelist.clearInstanceWhitelist, false, 'Instance ID is required', 'Failed to clear whitelist']
  ])('%s', (channel, serviceMethod, needsPlayer, required, fallback) => {
    const method = serviceMethod as jest.Mock;
    const valid = { instanceId: 'a1', playerId: ' 0002abc ', requestId: 'r1' };

    it('works on the instance and replies without a requestId', async () => {
      method.mockReturnValue({ success: true, playerIds: ['0002abc'], message: 'Done' });

      await handlers[channel](valid, sender);

      expect(method).toHaveBeenCalledWith('a1', ...(needsPlayer ? ['0002abc'] : []));
      expect(replies(channel)).toEqual([{ success: true, playerIds: ['0002abc'], message: 'Done', error: undefined }]);
    });

    it('replies an empty list with the service\'s refusal', async () => {
      method.mockReturnValue({ success: false, error: 'Player is already in the whitelist' });

      await handlers[channel](valid, sender);

      expect(replies(channel)).toEqual([
        { success: false, playerIds: [], message: undefined, error: 'Player is already in the whitelist' }
      ]);
    });

    it.each([
      ['an Error', new Error('EACCES'), 'EACCES'],
      ['nothing useful', undefined, fallback]
    ])('replies a failure when the service throws %s', async (_label, thrown, error) => {
      method.mockImplementation(() => { throw thrown; });

      await handlers[channel](valid, sender);

      expect(replies(channel)).toEqual([{ success: false, error }]);
    });

    const incomplete: Array<[string, unknown]> = [
      ['no instance id', { playerId: 'p1' }],
      ['no payload', undefined],
      ...(needsPlayer ? [['no player id', { instanceId: 'a1' }], ['a player id that is not text', { instanceId: 'a1', playerId: 42 }]] as Array<[string, unknown]> : [])
    ];

    it.each(incomplete)('refuses %s', async (_label, payload) => {
      await handlers[channel](payload, sender);

      expect(method).not.toHaveBeenCalled();
      expect(replies(channel)).toEqual([{ success: false, error: required }]);
    });

    it('refuses an instance id that could leave the servers directory', async () => {
      await handlers[channel]({ ...valid, instanceId: '../x' }, sender);

      expect(method).not.toHaveBeenCalled();
      expect(replies(channel)).toEqual([{ success: false, error: 'Invalid instance ID' }]);
    });
  });

  // A server on another machine: its whitelist file is there.
  describe('a server hosted on another machine', () => {
    const router = jest.fn(async () => ({ success: true, playerIds: ['p1'] }));
    beforeEach(() => { router.mockClear(); setHostRouter(router); });
    afterEach(() => setHostRouter(null));

    it.each([
      ['load-whitelist', true, {}], ['add-to-whitelist', false, { playerId: 'p1' }],
      ['remove-from-whitelist', false, { playerId: 'p1' }], ['clear-whitelist', false, {}]
    ])('runs %s on that machine', async (channel, read, extra) => {
      await handlers[channel as string]({ instanceId: 'far', ...(extra as object) }, sender);

      expect(router).toHaveBeenCalledWith(channel, 'far', { instanceId: 'far', ...(extra as object) }, read, sender);
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(channel, { success: true, playerIds: ['p1'] }, sender);
    });
  });
});
