import { messagingService } from '../services/messaging.service';
import { activityLogService } from '../services/activity-log.service';
import { identifySender } from '../services/auth/permission-gate';
import { getAllInstances } from '../utils/ark/instance.utils';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn(), sendToAll: jest.fn() }
}));
jest.mock('../services/activity-log.service', () => ({
  activityLogService: { list: jest.fn(), clear: jest.fn() }
}));

jest.mock('../services/auth/permission-gate', () => ({ identifySender: jest.fn() }));
jest.mock('../utils/ark/instance.utils', () => ({ getAllInstances: jest.fn() }));

const mockMessaging = jest.mocked(messagingService);
const mockActivity = jest.mocked(activityLogService);
const mockIdentify = jest.mocked(identifySender);
const mockGetAllInstances = jest.mocked(getAllInstances);

const DESKTOP: ReturnType<typeof identifySender> = { user: null, permissions: [], isAdmin: true, isLocalDesktop: true };
const OPERATOR: ReturnType<typeof identifySender> = {
  user: { id: 'op1', username: 'op1', displayName: 'op1', roleId: 'operator', roleName: 'Operator', ownerUserId: null, active: true, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null, permissions: [] },
  permissions: [], isAdmin: false, isLocalDesktop: false
};

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('activity-handler', () => {
  const sender = { send: jest.fn() };
  const entry = { id: 1, kind: 'start' as const, message: 'Alpha started', instanceId: 'a1', username: null, createdAt: 1 };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./activity-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  beforeEach(() => {
    mockIdentify.mockReturnValue(DESKTOP);
    mockGetAllInstances.mockResolvedValue([]);
  });

  describe('for a pool member', () => {
    it('shows only entries about servers in the pool, never global ones', async () => {
      mockIdentify.mockReturnValue(OPERATOR);
      mockGetAllInstances.mockResolvedValue([{ id: 'a1', operatorUserId: 'op1' }, { id: 'b2', operatorUserId: null }] as never);
      const other = { ...entry, id: 2, instanceId: 'b2' };
      const global = { ...entry, id: 3, instanceId: null, message: 'Web server started' };
      mockActivity.list.mockReturnValue([entry, other, global]);

      await handlers['get-activity']({ requestId: 'r1' }, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-activity', { success: true, entries: [entry], requestId: 'r1' }, sender);
    });

    it('does not read the server list for an admin', async () => {
      mockActivity.list.mockReturnValue([entry]);

      await handlers['get-activity']({ requestId: 'r1' }, sender);

      expect(mockGetAllInstances).not.toHaveBeenCalled();
    });
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
