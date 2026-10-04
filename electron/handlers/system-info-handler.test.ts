import { messagingService } from '../services/messaging.service';
import { platformService } from '../services/platform.service';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/platform.service', () => ({
  platformService: { getNodeVersion: jest.fn(), getElectronVersion: jest.fn(), getPlatform: jest.fn(), getConfigPath: jest.fn() }
}));

const mockMessaging = jest.mocked(messagingService);
const mockPlatform = jest.mocked(platformService);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('system-info-handler', () => {
  const sender = { send: jest.fn() };
  let handler: Listener;

  beforeAll(() => {
    require('./system-info-handler');
    handler = mockMessaging.on.mock.calls.find(([channel]) => channel === 'get-system-info')![1] as Listener;
  });

  beforeEach(() => {
    mockPlatform.getNodeVersion.mockReturnValue('16.16.0');
    mockPlatform.getElectronVersion.mockReturnValue('21.4.4');
    mockPlatform.getPlatform.mockReturnValue('windows');
    mockPlatform.getConfigPath.mockReturnValue('C:\\Users\\user\\AppData\\Roaming\\Cerious AASM');
  });

  it('replies with the versions, platform and config path', async () => {
    await handler({ requestId: 'r1' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-system-info', {
      nodeVersion: '16.16.0',
      electronVersion: '21.4.4',
      platform: 'windows',
      configPath: 'C:\\Users\\user\\AppData\\Roaming\\Cerious AASM',
      requestId: 'r1'
    }, sender);
  });

  it('passes on versions the platform cannot tell', async () => {
    mockPlatform.getElectronVersion.mockReturnValue(null);

    await handler({ requestId: 'r1' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-system-info', expect.objectContaining({ electronVersion: null }), sender);
  });

  it.each([
    ['an Error', new Error('Platform service unavailable'), 'Platform service unavailable'],
    ['a string', 'String error', 'String error']
  ])('replies { error } without success when reading throws %s', async (_label, thrown, error) => {
    mockPlatform.getNodeVersion.mockImplementation(() => { throw thrown; });

    await handler({ requestId: 'r1' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-system-info', { error, requestId: 'r1' }, sender);
  });

  it('answers a request without a payload', async () => {
    await handler(undefined, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-system-info', expect.objectContaining({ platform: 'windows', requestId: undefined }), sender);
  });
});
