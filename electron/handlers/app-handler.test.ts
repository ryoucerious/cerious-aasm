import { messagingService } from '../services/messaging.service';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() },
}));

jest.mock('../utils/logger', () => ({ getLogFilePath: jest.fn(() => '/logs/cerious-aasm.log') }));

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

const mockMessaging = jest.mocked(messagingService);

describe('app-handler', () => {
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./app-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  it('answers get-log-file-path from the moment it is imported', async () => {
    const sender = { send: jest.fn() };

    await handlers['get-log-file-path']({ requestId: 'r1' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
      'get-log-file-path', { path: '/logs/cerious-aasm.log', requestId: 'r1' }, sender
    );
  });

  it('answers a request without a payload', async () => {
    const sender = { send: jest.fn() };

    await handlers['get-log-file-path'](undefined, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
      'get-log-file-path', { path: '/logs/cerious-aasm.log', requestId: undefined }, sender
    );
  });
});
