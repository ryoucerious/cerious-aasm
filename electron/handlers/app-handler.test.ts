import { messagingService } from '../services/messaging.service';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() },
}));

jest.mock('../utils/logger', () => ({ getLogFilePath: jest.fn(() => '/logs/cerious-aasm.log') }));
jest.mock('../services/run-at-startup.service', () => ({
  runAtStartupStatus: jest.fn(() => ({ supported: true, enabled: false })),
  setRunAtStartup: jest.fn((enabled: boolean) => ({ supported: true, enabled }))
}));
jest.mock('../services/application.service', () => ({ applicationService: { isHeadless: jest.fn(() => false) } }));

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

  it('says whether the app starts with the computer, and switches it', async () => {
    const { setRunAtStartup } = jest.requireMock('../services/run-at-startup.service') as { setRunAtStartup: jest.Mock };
    const sender = { send: jest.fn() };

    await handlers['get-run-at-startup']({ requestId: 'r2' }, sender);
    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-run-at-startup', { supported: true, enabled: false, requestId: 'r2' }, sender);

    await handlers['set-run-at-startup']({ enabled: true, requestId: 'r3' }, sender);
    expect(setRunAtStartup).toHaveBeenCalledWith(true, { headless: false });
    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('set-run-at-startup', { supported: true, enabled: true, requestId: 'r3' }, sender);
  });

  it('answers a request without a payload', async () => {
    const sender = { send: jest.fn() };

    await handlers['get-log-file-path'](undefined, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
      'get-log-file-path', { path: '/logs/cerious-aasm.log', requestId: undefined }, sender
    );
  });
});
