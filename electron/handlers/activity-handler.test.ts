import { messagingService } from '../services/messaging.service';
import { activityLogService } from '../services/activity-log.service';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn(), sendToAll: jest.fn() }
}));
jest.mock('../services/activity-log.service', () => ({
  activityLogService: { list: jest.fn(), clear: jest.fn() }
}));

const mockMessaging = jest.mocked(messagingService);
const mockActivity = jest.mocked(activityLogService);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('activity-handler', () => {
  const sender = { send: jest.fn() };
  const entry = { id: 1, kind: 'start' as const, message: 'Alpha started', instanceId: 'a1', username: null, createdAt: 1 };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./activity-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  describe('get-activity', () => {
    it('replies with the newest entries, up to the limit asked for', async () => {
      mockActivity.list.mockReturnValue([entry]);

      await handlers['get-activity']({ limit: 20, requestId: 'r1' }, sender);

      expect(mockActivity.list).toHaveBeenCalledWith(20);
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-activity', { success: true, entries: [entry], requestId: 'r1' }, sender);
    });

    it.each([[undefined], [{ limit: '5' }]])('reads 100 entries without a numeric limit (payload %p)', async payload => {
      mockActivity.list.mockReturnValue([]);

      await handlers['get-activity'](payload, sender);

      expect(mockActivity.list).toHaveBeenCalledWith(100);
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-activity', { success: true, entries: [], requestId: undefined }, sender);
    });

    it('replies an empty list with the reason reading fails', async () => {
      mockActivity.list.mockImplementation(() => { throw new Error('database locked'); });

      await handlers['get-activity']({ requestId: 'r1' }, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'get-activity', { success: false, error: 'database locked', entries: [], requestId: 'r1' }, sender
      );
    });
  });

  describe('clear-activity', () => {
    it('clears the feed, replies, then tells every client', async () => {
      await handlers['clear-activity']({ requestId: 'r1' }, sender);

      expect(mockActivity.clear).toHaveBeenCalled();
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('clear-activity', { success: true, requestId: 'r1' }, sender);
      expect(mockMessaging.sendToAll).toHaveBeenCalledWith('activity-changed', {});
      expect(mockMessaging.sendToOriginator.mock.invocationCallOrder[0]).toBeLessThan(mockMessaging.sendToAll.mock.invocationCallOrder[0]);
    });

    it('replies with the reason clearing fails and tells nobody', async () => {
      mockActivity.clear.mockImplementationOnce(() => { throw new Error('database locked'); });

      await handlers['clear-activity']({ requestId: 'r1' }, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('clear-activity', { success: false, error: 'database locked', requestId: 'r1' }, sender);
      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
    });

    it('answers a request without a payload', async () => {
      await handlers['clear-activity'](undefined, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('clear-activity', { success: true, requestId: undefined }, sender);
    });
  });
});
