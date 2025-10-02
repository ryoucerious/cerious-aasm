
import { messagingService } from '../services/messaging.service';
import { firewallService } from '../services/firewall.service';
import * as platformUtils from '../utils/platform.utils';

// Mock the services
jest.mock('../services/messaging.service');
jest.mock('../services/firewall.service');

const mockMessagingService = messagingService as jest.Mocked<typeof messagingService>;
const mockFirewallService = firewallService as jest.Mocked<typeof firewallService>;

// Import the handler to register the event listeners
import '../handlers/firewall-handler';

// Get the registered event handlers
const setupArkServerFirewallHandler = mockMessagingService.on.mock.calls.find(call => call[0] === 'setup-ark-server-firewall')?.[1] as (payload: any, sender: any) => Promise<void>;
const setupWebServerFirewallHandler = mockMessagingService.on.mock.calls.find(call => call[0] === 'setup-web-server-firewall')?.[1] as (payload: any, sender: any) => Promise<void>;
const getLinuxFirewallInstructionsHandler = mockMessagingService.on.mock.calls.find(call => call[0] === 'get-linux-firewall-instructions')?.[1] as (payload: any, sender: any) => Promise<void>;
const checkFirewallEnabledHandler = mockMessagingService.on.mock.calls.find(call => call[0] === 'check-firewall-enabled')?.[1] as (payload: any, sender: any) => Promise<void>;

const mockSender = {} as Electron.WebContents;

describe('Firewall Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('setup-ark-server-firewall event', () => {
    it('should handle undefined payload (payload || {})', async () => {
      jest.spyOn(mockFirewallService, 'getArkServerFirewallInstructions').mockResolvedValue({ success: true, platform: 'linux', instructions: '', error: undefined });
      await setupArkServerFirewallHandler(undefined, mockSender);
      expect(mockFirewallService.getArkServerFirewallInstructions).toHaveBeenCalledWith(undefined, undefined, undefined);
    });
    it('should handle null payload (payload || {})', async () => {
      jest.spyOn(mockFirewallService, 'getArkServerFirewallInstructions').mockResolvedValue({ success: true, platform: 'linux', instructions: '', error: undefined });
      await setupArkServerFirewallHandler(null, mockSender);
      expect(mockFirewallService.getArkServerFirewallInstructions).toHaveBeenCalledWith(undefined, undefined, undefined);
    });
    it('should handle setup ARK server firewall exception with string error', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-err-string'
      };
      jest.spyOn(mockFirewallService, 'getArkServerFirewallInstructions').mockRejectedValue('string error');
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await setupArkServerFirewallHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-ark-server-firewall', {
        success: false,
        platform: 'linux',
        message: 'Failed to generate ARK server firewall instructions',
        error: 'Failed to generate ARK server firewall instructions',
        requestId: 'test-err-string'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle setup ARK server firewall exception with undefined error', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-err-undef'
      };
      jest.spyOn(mockFirewallService, 'getArkServerFirewallInstructions').mockRejectedValue(undefined);
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await setupArkServerFirewallHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-ark-server-firewall', {
        success: false,
        platform: 'linux',
        message: 'Failed to generate ARK server firewall instructions',
        error: 'Failed to generate ARK server firewall instructions',
        requestId: 'test-err-undef'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle setup ARK server firewall exception with string error', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-err-string'
      };
      jest.spyOn(mockFirewallService, 'getArkServerFirewallInstructions').mockRejectedValue('string error');
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await setupArkServerFirewallHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-ark-server-firewall', {
        success: false,
        platform: 'linux',
        message: 'Failed to generate ARK server firewall instructions',
        error: 'Failed to generate ARK server firewall instructions',
        requestId: 'test-err-string'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle setup ARK server firewall exception with undefined error', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-err-undef'
      };
      jest.spyOn(mockFirewallService, 'getArkServerFirewallInstructions').mockRejectedValue(undefined);
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await setupArkServerFirewallHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-ark-server-firewall', {
        success: false,
        platform: 'linux',
        message: 'Failed to generate ARK server firewall instructions',
        error: 'Failed to generate ARK server firewall instructions',
        requestId: 'test-err-undef'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should setup ARK server firewall successfully', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-123'
      };
      const expectedResult = {
        success: true,
        platform: 'linux',
        instructions: 'sudo ufw allow 7777/tcp\nsudo ufw allow 27015/udp\nsudo ufw allow 32330/tcp'
      };

      mockFirewallService.getArkServerFirewallInstructions.mockResolvedValue(expectedResult);

      await setupArkServerFirewallHandler(payload, mockSender);

      expect(mockFirewallService.getArkServerFirewallInstructions).toHaveBeenCalledWith(7777, 27015, 32330);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-ark-server-firewall', {
        success: true,
        platform: 'linux',
        instructions: 'sudo ufw allow 7777/tcp\nsudo ufw allow 27015/udp\nsudo ufw allow 32330/tcp',
        message: 'Linux firewall configuration instructions provided',
        error: undefined,
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle setup ARK server firewall failure', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-123'
      };
      const expectedResult = {
        success: false,
        platform: 'linux',
        error: 'Invalid ports'
      };

      mockFirewallService.getArkServerFirewallInstructions.mockResolvedValue(expectedResult);

      await setupArkServerFirewallHandler(payload, mockSender);

      expect(mockFirewallService.getArkServerFirewallInstructions).toHaveBeenCalledWith(7777, 27015, 32330);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-ark-server-firewall', {
        success: false,
        platform: 'linux',
        instructions: undefined,
        message: 'Failed to generate firewall instructions',
        error: 'Invalid ports',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle setup ARK server firewall exception (windows)', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-123'
      };
      const error = new Error('Network error');

      mockFirewallService.getArkServerFirewallInstructions.mockRejectedValue(error);
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('windows');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await setupArkServerFirewallHandler(payload, mockSender);

      expect(mockFirewallService.getArkServerFirewallInstructions).toHaveBeenCalledWith(7777, 27015, 32330);
      expect(consoleSpy).toHaveBeenCalledWith('[firewall-handler] Failed to handle setup-ark-server-firewall:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-ark-server-firewall', {
        success: false,
        platform: 'windows',
        message: 'Failed to generate ARK server firewall instructions',
        error: 'Network error',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });

    it('should handle setup ARK server firewall exception (linux)', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-123'
      };
      const error = new Error('Network error');

      mockFirewallService.getArkServerFirewallInstructions.mockRejectedValue(error);
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await setupArkServerFirewallHandler(payload, mockSender);

      expect(mockFirewallService.getArkServerFirewallInstructions).toHaveBeenCalledWith(7777, 27015, 32330);
      expect(consoleSpy).toHaveBeenCalledWith('[firewall-handler] Failed to handle setup-ark-server-firewall:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-ark-server-firewall', {
        success: false,
        platform: 'linux',
        message: 'Failed to generate ARK server firewall instructions',
        error: 'Network error',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });
  });

  describe('setup-web-server-firewall event', () => {
    it('should handle undefined payload (payload || {})', async () => {
      jest.spyOn(mockFirewallService, 'getWebServerFirewallInstructions').mockResolvedValue({ success: true, platform: 'linux', instructions: '', error: undefined });
      await setupWebServerFirewallHandler(undefined, mockSender);
      expect(mockFirewallService.getWebServerFirewallInstructions).toHaveBeenCalledWith(undefined);
    });
    it('should handle null payload (payload || {})', async () => {
      jest.spyOn(mockFirewallService, 'getWebServerFirewallInstructions').mockResolvedValue({ success: true, platform: 'linux', instructions: '', error: undefined });
      await setupWebServerFirewallHandler(null, mockSender);
      expect(mockFirewallService.getWebServerFirewallInstructions).toHaveBeenCalledWith(undefined);
    });
    it('should handle setup web server firewall exception with string error', async () => {
      const payload = { port: 3000, requestId: 'test-err-string' };
      jest.spyOn(mockFirewallService, 'getWebServerFirewallInstructions').mockRejectedValue('string error');
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await setupWebServerFirewallHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-web-server-firewall', {
        success: false,
        platform: 'linux',
        message: 'Failed to generate web server firewall instructions',
        error: 'Failed to generate web server firewall instructions',
        requestId: 'test-err-string'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle setup web server firewall exception with undefined error', async () => {
      const payload = { port: 3000, requestId: 'test-err-undef' };
      jest.spyOn(mockFirewallService, 'getWebServerFirewallInstructions').mockRejectedValue(undefined);
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await setupWebServerFirewallHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-web-server-firewall', {
        success: false,
        platform: 'linux',
        message: 'Failed to generate web server firewall instructions',
        error: 'Failed to generate web server firewall instructions',
        requestId: 'test-err-undef'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle setup web server firewall exception with string error', async () => {
      const payload = { port: 3000, requestId: 'test-err-string' };
      jest.spyOn(mockFirewallService, 'getWebServerFirewallInstructions').mockRejectedValue('string error');
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await setupWebServerFirewallHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-web-server-firewall', {
        success: false,
        platform: 'linux',
        message: 'Failed to generate web server firewall instructions',
        error: 'Failed to generate web server firewall instructions',
        requestId: 'test-err-string'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle setup web server firewall exception with undefined error', async () => {
      const payload = { port: 3000, requestId: 'test-err-undef' };
      jest.spyOn(mockFirewallService, 'getWebServerFirewallInstructions').mockRejectedValue(undefined);
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await setupWebServerFirewallHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-web-server-firewall', {
        success: false,
        platform: 'linux',
        message: 'Failed to generate web server firewall instructions',
        error: 'Failed to generate web server firewall instructions',
        requestId: 'test-err-undef'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should setup web server firewall successfully', async () => {
      const payload = {
        port: 3000,
        requestId: 'test-123'
      };
      const expectedResult = {
        success: true,
        platform: 'linux',
        instructions: '# Linux Firewall Configuration for Web Server\n\n# For UFW (Ubuntu/Debian):\nsudo ufw allow 3000/tcp  # Web server port\n\n# For firewalld (CentOS/RHEL/Fedora):\nsudo firewall-cmd --permanent --add-port=3000/tcp\nsudo firewall-cmd --reload'
      };

      mockFirewallService.getWebServerFirewallInstructions.mockResolvedValue(expectedResult);

      await setupWebServerFirewallHandler(payload, mockSender);

      expect(mockFirewallService.getWebServerFirewallInstructions).toHaveBeenCalledWith(3000);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-web-server-firewall', {
        success: true,
        platform: 'linux',
        instructions: '# Linux Firewall Configuration for Web Server\n\n# For UFW (Ubuntu/Debian):\nsudo ufw allow 3000/tcp  # Web server port\n\n# For firewalld (CentOS/RHEL/Fedora):\nsudo firewall-cmd --permanent --add-port=3000/tcp\nsudo firewall-cmd --reload',
        message: 'Linux firewall configuration instructions for port 3000 provided',
        error: undefined,
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle setup web server firewall failure', async () => {
      const payload = {
        port: 3000,
        requestId: 'test-123'
      };
      const expectedResult = {
        success: false,
        platform: 'linux',
        error: 'Invalid port'
      };

      mockFirewallService.getWebServerFirewallInstructions.mockResolvedValue(expectedResult);

      await setupWebServerFirewallHandler(payload, mockSender);

      expect(mockFirewallService.getWebServerFirewallInstructions).toHaveBeenCalledWith(3000);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-web-server-firewall', {
        success: false,
        platform: 'linux',
        instructions: undefined,
        message: 'Failed to generate web server firewall instructions',
        error: 'Invalid port',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle setup web server firewall exception (windows)', async () => {
      const payload = {
        port: 3000,
        requestId: 'test-123'
      };
      const error = new Error('Permission denied');

      mockFirewallService.getWebServerFirewallInstructions.mockRejectedValue(error);
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('windows');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await setupWebServerFirewallHandler(payload, mockSender);

      expect(mockFirewallService.getWebServerFirewallInstructions).toHaveBeenCalledWith(3000);
      expect(consoleSpy).toHaveBeenCalledWith('[firewall-handler] Failed to handle setup-web-server-firewall:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-web-server-firewall', {
        success: false,
        platform: 'windows',
        message: 'Failed to generate web server firewall instructions',
        error: 'Permission denied',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });

    it('should handle setup web server firewall exception (linux)', async () => {
      const payload = {
        port: 3000,
        requestId: 'test-123'
      };
      const error = new Error('Permission denied');

      mockFirewallService.getWebServerFirewallInstructions.mockRejectedValue(error);
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await setupWebServerFirewallHandler(payload, mockSender);

      expect(mockFirewallService.getWebServerFirewallInstructions).toHaveBeenCalledWith(3000);
      expect(consoleSpy).toHaveBeenCalledWith('[firewall-handler] Failed to handle setup-web-server-firewall:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('setup-web-server-firewall', {
        success: false,
        platform: 'linux',
        message: 'Failed to generate web server firewall instructions',
        error: 'Permission denied',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });
  });

  describe('get-linux-firewall-instructions event', () => {
    it('should handle undefined payload (payload || {})', async () => {
      jest.spyOn(mockFirewallService, 'getArkServerFirewallInstructions').mockResolvedValue({ success: true, platform: 'linux', instructions: '', error: undefined });
      await getLinuxFirewallInstructionsHandler(undefined, mockSender);
      expect(mockFirewallService.getArkServerFirewallInstructions).toHaveBeenCalledWith(undefined, undefined, undefined);
    });
    it('should handle null payload (payload || {})', async () => {
      jest.spyOn(mockFirewallService, 'getArkServerFirewallInstructions').mockResolvedValue({ success: true, platform: 'linux', instructions: '', error: undefined });
      await getLinuxFirewallInstructionsHandler(null, mockSender);
      expect(mockFirewallService.getArkServerFirewallInstructions).toHaveBeenCalledWith(undefined, undefined, undefined);
    });
    it('should handle get Linux firewall instructions exception with string error', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-err-string'
      };
      jest.spyOn(mockFirewallService, 'getArkServerFirewallInstructions').mockRejectedValue('string error');
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await getLinuxFirewallInstructionsHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-linux-firewall-instructions', {
        success: false,
        platform: 'linux',
        error: 'Failed to get Linux firewall instructions',
        requestId: 'test-err-string'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle get Linux firewall instructions exception with undefined error', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-err-undef'
      };
      jest.spyOn(mockFirewallService, 'getArkServerFirewallInstructions').mockRejectedValue(undefined);
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await getLinuxFirewallInstructionsHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-linux-firewall-instructions', {
        success: false,
        platform: 'linux',
        error: 'Failed to get Linux firewall instructions',
        requestId: 'test-err-undef'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle get Linux firewall instructions exception with string error', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-err-string'
      };
      jest.spyOn(mockFirewallService, 'getArkServerFirewallInstructions').mockRejectedValue('string error');
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await getLinuxFirewallInstructionsHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-linux-firewall-instructions', {
        success: false,
        platform: 'linux',
        error: 'Failed to get Linux firewall instructions',
        requestId: 'test-err-string'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle get Linux firewall instructions exception with undefined error', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-err-undef'
      };
      jest.spyOn(mockFirewallService, 'getArkServerFirewallInstructions').mockRejectedValue(undefined);
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await getLinuxFirewallInstructionsHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-linux-firewall-instructions', {
        success: false,
        platform: 'linux',
        error: 'Failed to get Linux firewall instructions',
        requestId: 'test-err-undef'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should get Linux firewall instructions successfully', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-123'
      };
      const expectedResult = {
        success: true,
        platform: 'linux',
        instructions: 'sudo ufw allow 7777/tcp\nsudo ufw allow 27015/udp\nsudo ufw allow 32330/tcp'
      };

      mockFirewallService.getArkServerFirewallInstructions.mockResolvedValue(expectedResult);

      await getLinuxFirewallInstructionsHandler(payload, mockSender);

      expect(mockFirewallService.getArkServerFirewallInstructions).toHaveBeenCalledWith(7777, 27015, 32330);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-linux-firewall-instructions', {
        success: true,
        instructions: 'sudo ufw allow 7777/tcp\nsudo ufw allow 27015/udp\nsudo ufw allow 32330/tcp',
        platform: 'linux',
        error: undefined,
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle get Linux firewall instructions failure', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-123'
      };
      const expectedResult = {
        success: false,
        platform: 'linux',
        error: 'Port conflict'
      };

      mockFirewallService.getArkServerFirewallInstructions.mockResolvedValue(expectedResult);

      await getLinuxFirewallInstructionsHandler(payload, mockSender);

      expect(mockFirewallService.getArkServerFirewallInstructions).toHaveBeenCalledWith(7777, 27015, 32330);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-linux-firewall-instructions', {
        success: false,
        instructions: undefined,
        platform: 'linux',
        error: 'Port conflict',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle get Linux firewall instructions exception (windows)', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-123'
      };
      const error = new Error('System error');

      mockFirewallService.getArkServerFirewallInstructions.mockRejectedValue(error);
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('windows');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getLinuxFirewallInstructionsHandler(payload, mockSender);

      expect(mockFirewallService.getArkServerFirewallInstructions).toHaveBeenCalledWith(7777, 27015, 32330);
      expect(consoleSpy).toHaveBeenCalledWith('[firewall-handler] Failed to handle get-linux-firewall-instructions:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-linux-firewall-instructions', {
        success: false,
        platform: 'windows',
        error: 'System error',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });

    it('should handle get Linux firewall instructions exception (linux)', async () => {
      const payload = {
        gamePort: 7777,
        queryPort: 27015,
        rconPort: 32330,
        requestId: 'test-123'
      };
      const error = new Error('System error');

      mockFirewallService.getArkServerFirewallInstructions.mockRejectedValue(error);
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getLinuxFirewallInstructionsHandler(payload, mockSender);

      expect(mockFirewallService.getArkServerFirewallInstructions).toHaveBeenCalledWith(7777, 27015, 32330);
      expect(consoleSpy).toHaveBeenCalledWith('[firewall-handler] Failed to handle get-linux-firewall-instructions:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-linux-firewall-instructions', {
        success: false,
        platform: 'linux',
        error: 'System error',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });
  });
  describe('check-firewall-enabled event', () => {
    it('should handle undefined payload (payload || {})', async () => {
      await checkFirewallEnabledHandler(undefined, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-firewall-enabled', {
        success: true,
        platform: 'windows',
        enabled: false,
        message: 'Firewall management not available on this platform',
        requestId: undefined
      }, mockSender);
    });
    it('should handle null payload (payload || {})', async () => {
      await checkFirewallEnabledHandler(null, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-firewall-enabled', {
        success: true,
        platform: 'windows',
        enabled: false,
        message: 'Firewall management not available on this platform',
        requestId: undefined
      }, mockSender);
    });
    it('should handle check-firewall-enabled exception with string error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      let callCount = 0;
      jest.spyOn(platformUtils, 'getPlatform').mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw 'string error';
        return 'linux';
      });
      await checkFirewallEnabledHandler({ requestId: 'err-string' }, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-firewall-enabled', {
        success: false,
        platform: 'linux',
        enabled: false,
        message: 'Failed to check firewall status',
        error: 'Failed to check firewall status',
        requestId: 'err-string'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle check-firewall-enabled exception with undefined error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      let callCount = 0;
      jest.spyOn(platformUtils, 'getPlatform').mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw undefined;
        return 'linux';
      });
      await checkFirewallEnabledHandler({ requestId: 'err-undef' }, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-firewall-enabled', {
        success: false,
        platform: 'linux',
        enabled: false,
        message: 'Failed to check firewall status',
        error: 'Failed to check firewall status',
        requestId: 'err-undef'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle check-firewall-enabled exception with string error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      let callCount = 0;
      jest.spyOn(platformUtils, 'getPlatform').mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw 'string error';
        return 'linux';
      });
      await checkFirewallEnabledHandler({ requestId: 'err-string' }, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-firewall-enabled', {
        success: false,
        platform: 'linux',
        enabled: false,
        message: 'Failed to check firewall status',
        error: 'Failed to check firewall status',
        requestId: 'err-string'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle check-firewall-enabled exception with undefined error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      let callCount = 0;
      jest.spyOn(platformUtils, 'getPlatform').mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw undefined;
        return 'linux';
      });
      await checkFirewallEnabledHandler({ requestId: 'err-undef' }, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-firewall-enabled', {
        success: false,
        platform: 'linux',
        enabled: false,
        message: 'Failed to check firewall status',
        error: 'Failed to check firewall status',
        requestId: 'err-undef'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should return enabled true and Linux message on linux platform', async () => {
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      await checkFirewallEnabledHandler({ requestId: 'linux-1' }, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-firewall-enabled', {
        success: true,
        platform: 'linux',
        enabled: true,
        message: 'Firewall management available on Linux',
        requestId: 'linux-1'
      }, mockSender);
    });

    it('should return enabled false and non-Linux message on windows platform', async () => {
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('windows');
      await checkFirewallEnabledHandler({ requestId: 'win-1' }, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-firewall-enabled', {
        success: true,
        platform: 'windows',
        enabled: false,
        message: 'Firewall management not available on this platform',
        requestId: 'win-1'
      }, mockSender);
    });

    it('should handle exception and return error branch', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('Platform error');
      let callCount = 0;
      jest.spyOn(platformUtils, 'getPlatform').mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw error; // throw on first call (try block)
        return 'linux'; // return a valid platform string on second call (catch block)
      });
      await checkFirewallEnabledHandler({ requestId: 'err-1' }, mockSender);
      expect(consoleSpy).toHaveBeenCalledWith('[firewall-handler] Failed to handle check-firewall-enabled:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-firewall-enabled', {
        success: false,
        platform: 'linux',
        enabled: false,
        message: 'Failed to check firewall status',
        error: 'Platform error',
        requestId: 'err-1'
      }, mockSender);
      consoleSpy.mockRestore();
    });
  });
});