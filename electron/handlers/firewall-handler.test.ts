import { messagingService } from '../services/messaging.service';
import { firewallService } from '../services/firewall.service';
import { getPlatform } from '../utils/platform.utils';
import { getDockerNetworkInfo } from '../utils/docker-network.utils';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/firewall.service', () => ({
  firewallService: { getArkServerFirewallInstructions: jest.fn(), getWebServerFirewallInstructions: jest.fn() }
}));
jest.mock('../utils/platform.utils', () => ({ getPlatform: jest.fn() }));
jest.mock('../utils/docker-network.utils', () => ({ getDockerNetworkInfo: jest.fn() }));

const mockMessaging = jest.mocked(messagingService);
const mockFirewall = jest.mocked(firewallService);
const mockGetPlatform = jest.mocked(getPlatform);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

const ARK_FAILURE = 'Failed to generate ARK server firewall instructions';
const WEB_FAILURE = 'Failed to generate web server firewall instructions';

describe('firewall-handler', () => {
  const sender = { send: jest.fn() };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./firewall-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  beforeEach(() => {
    mockGetPlatform.mockReset();
    mockGetPlatform.mockReturnValue('linux');
    // Not in Docker unless a test says so, even when the suite itself runs in a container.
    jest.mocked(getDockerNetworkInfo).mockReturnValue(null);
  });

  function replies(channel: string): unknown[] {
    return mockMessaging.sendToOriginator.mock.calls.filter(([replyChannel]) => replyChannel === channel).map(call => call[1]);
  }

  describe('setup-ark-server-firewall', () => {
    const ports = { gamePort: 7777, queryPort: 27015, rconPort: 32330 };

    it('replies with the instructions for the three ports', async () => {
      const instructions = 'sudo ufw allow 7777/udp';
      mockFirewall.getArkServerFirewallInstructions.mockResolvedValue({ success: true, platform: 'linux', instructions });

      await handlers['setup-ark-server-firewall']({ ...ports, requestId: 'r1' }, sender);

      expect(mockFirewall.getArkServerFirewallInstructions).toHaveBeenCalledWith(7777, 27015, 32330);
      expect(replies('setup-ark-server-firewall')).toEqual([{
        success: true, platform: 'linux', instructions,
        message: 'Linux firewall configuration instructions provided', error: undefined, requestId: 'r1'
      }]);
    });

    it('passes on instructions the service could not make', async () => {
      mockFirewall.getArkServerFirewallInstructions.mockResolvedValue({ success: false, platform: 'linux', error: 'Invalid ports' });

      await handlers['setup-ark-server-firewall']({ ...ports, requestId: 'r1' }, sender);

      expect(replies('setup-ark-server-firewall')).toEqual([{
        success: false, platform: 'linux', instructions: undefined,
        message: 'Failed to generate firewall instructions', error: 'Invalid ports', requestId: 'r1'
      }]);
    });

    it.each([
      ['an Error on windows', new Error('Network error'), 'windows', 'Network error'],
      ['a string', 'string error', 'linux', 'string error'],
      ['nothing useful', undefined, 'linux', ARK_FAILURE]
    ])('replies a failure with the platform when the service throws %s', async (_label, thrown, platform, error) => {
      mockGetPlatform.mockReturnValue(platform as ReturnType<typeof getPlatform>);
      mockFirewall.getArkServerFirewallInstructions.mockRejectedValue(thrown);

      await handlers['setup-ark-server-firewall']({ ...ports, requestId: 'r1' }, sender);

      expect(replies('setup-ark-server-firewall')).toEqual([{ success: false, platform, message: ARK_FAILURE, error, requestId: 'r1' }]);
    });

    it.each([undefined, null])('answers a request without a payload (%p)', async payload => {
      mockFirewall.getArkServerFirewallInstructions.mockResolvedValue({ success: true, platform: 'linux', instructions: '' });

      await handlers['setup-ark-server-firewall'](payload, sender);

      expect(mockFirewall.getArkServerFirewallInstructions).toHaveBeenCalledWith(undefined, undefined, undefined);
      expect(replies('setup-ark-server-firewall')).toEqual([expect.objectContaining({ success: true, requestId: undefined })]);
    });
  });

  describe('setup-web-server-firewall', () => {
    it('replies with the instructions for the port', async () => {
      const instructions = 'sudo ufw allow 3000/tcp';
      mockFirewall.getWebServerFirewallInstructions.mockResolvedValue({ success: true, platform: 'linux', instructions });

      await handlers['setup-web-server-firewall']({ port: 3000, requestId: 'r1' }, sender);

      expect(mockFirewall.getWebServerFirewallInstructions).toHaveBeenCalledWith(3000);
      expect(replies('setup-web-server-firewall')).toEqual([{
        success: true, platform: 'linux', instructions,
        message: 'Linux firewall configuration instructions for port 3000 provided', error: undefined, requestId: 'r1'
      }]);
    });

    it('passes on instructions the service could not make', async () => {
      mockFirewall.getWebServerFirewallInstructions.mockResolvedValue({ success: false, platform: 'linux', error: 'Invalid port' });

      await handlers['setup-web-server-firewall']({ port: 80, requestId: 'r1' }, sender);

      expect(replies('setup-web-server-firewall')).toEqual([{
        success: false, platform: 'linux', instructions: undefined, message: WEB_FAILURE, error: 'Invalid port', requestId: 'r1'
      }]);
    });

    it.each([
      ['an Error', new Error('Network error'), 'Network error'],
      ['nothing useful', undefined, WEB_FAILURE]
    ])('replies a failure with the platform when the service throws %s', async (_label, thrown, error) => {
      mockFirewall.getWebServerFirewallInstructions.mockRejectedValue(thrown);

      await handlers['setup-web-server-firewall']({ port: 3000, requestId: 'r1' }, sender);

      expect(replies('setup-web-server-firewall')).toEqual([{ success: false, platform: 'linux', message: WEB_FAILURE, error, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockFirewall.getWebServerFirewallInstructions.mockResolvedValue({ success: false, platform: 'linux', error: 'Invalid port' });

      await handlers['setup-web-server-firewall'](undefined, sender);

      expect(mockFirewall.getWebServerFirewallInstructions).toHaveBeenCalledWith(undefined);
      expect(replies('setup-web-server-firewall')).toEqual([expect.objectContaining({ success: false, requestId: undefined })]);
    });
  });

  describe('get-linux-firewall-instructions', () => {
    it('replies with the ARK server instructions', async () => {
      mockFirewall.getArkServerFirewallInstructions.mockResolvedValue({ success: true, platform: 'linux', instructions: 'ufw' });

      await handlers['get-linux-firewall-instructions']({ gamePort: 7777, queryPort: 27015, rconPort: 32330, requestId: 'r1' }, sender);

      expect(mockFirewall.getArkServerFirewallInstructions).toHaveBeenCalledWith(7777, 27015, 32330);
      expect(replies('get-linux-firewall-instructions')).toEqual([
        { success: true, instructions: 'ufw', platform: 'linux', error: undefined, requestId: 'r1' }
      ]);
    });

    it.each([
      ['an Error', new Error('System error'), 'System error'],
      ['nothing useful', undefined, 'Failed to get Linux firewall instructions']
    ])('replies a failure with the platform, without a message, when the service throws %s', async (_label, thrown, error) => {
      mockFirewall.getArkServerFirewallInstructions.mockRejectedValue(thrown);

      await handlers['get-linux-firewall-instructions']({ requestId: 'r1' }, sender);

      expect(replies('get-linux-firewall-instructions')).toEqual([{ success: false, platform: 'linux', error, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockFirewall.getArkServerFirewallInstructions.mockResolvedValue({ success: true, platform: 'linux', instructions: '' });

      await handlers['get-linux-firewall-instructions'](undefined, sender);

      expect(replies('get-linux-firewall-instructions')).toEqual([expect.objectContaining({ success: true, requestId: undefined })]);
    });
  });

  describe('check-firewall-enabled', () => {
    it.each([
      ['linux', true, 'Firewall management available on Linux'],
      ['windows', false, 'Firewall management not available on this platform']
    ])('on %s replies enabled=%p', async (platform, enabled, message) => {
      mockGetPlatform.mockReturnValue(platform as ReturnType<typeof getPlatform>);

      await handlers['check-firewall-enabled']({ requestId: 'r1' }, sender);

      expect(replies('check-firewall-enabled')).toEqual([{ success: true, platform, enabled, message, requestId: 'r1' }]);
    });

    it('adds the Docker port ranges when running in Docker', async () => {
      const docker = {
        mode: 'published' as const,
        gamePorts: { start: 7777, end: 7900 },
        queryPorts: { start: 27015, end: 27030 },
        rconPorts: { start: 27020, end: 27050 },
        webPort: 3000
      };
      jest.mocked(getDockerNetworkInfo).mockReturnValue(docker);

      await handlers['check-firewall-enabled']({ requestId: 'r1' }, sender);

      expect(replies('check-firewall-enabled')).toEqual([{
        success: true, platform: 'linux', enabled: true, message: 'Firewall management available on Linux', docker, requestId: 'r1'
      }]);
    });

    it.each([
      ['an Error', new Error('Platform error'), 'Platform error'],
      ['nothing useful', undefined, 'Failed to check firewall status']
    ])('replies not enabled when checking throws %s', async (_label, thrown, error) => {
      mockGetPlatform.mockImplementationOnce(() => { throw thrown; });

      await handlers['check-firewall-enabled']({ requestId: 'r1' }, sender);

      expect(replies('check-firewall-enabled')).toEqual([{
        success: false, platform: 'linux', enabled: false, message: 'Failed to check firewall status', error, requestId: 'r1'
      }]);
    });

    it.each([undefined, null])('answers a request without a payload (%p)', async payload => {
      mockGetPlatform.mockReturnValue('windows');

      await handlers['check-firewall-enabled'](payload, sender);

      expect(replies('check-firewall-enabled')).toEqual([{
        success: true, platform: 'windows', enabled: false, message: 'Firewall management not available on this platform', requestId: undefined
      }]);
    });
  });
});
