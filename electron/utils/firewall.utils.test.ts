import { getLinuxFirewallInstructions, getLinuxServerPortsInstructions, getLinuxWebFirewallInstructions } from './firewall.utils';
import { DEFAULT_SERVER_PORT_RANGES } from './ark/port-sets';

describe('firewall.utils', () => {
  describe('getLinuxFirewallInstructions', () => {
    it('should generate UFW and firewalld instructions', () => {
      const result = getLinuxFirewallInstructions({
        game: 7777,
        query: 27015,
        rcon: 27020
      });

      expect(result).toContain('# Linux Firewall Configuration for ARK Server');
      expect(result).toContain('sudo ufw allow 7777/udp');
      expect(result).toContain('sudo ufw allow 27015/udp');
      expect(result).toContain('sudo ufw allow 27020/tcp');
      expect(result).toContain('sudo firewall-cmd --permanent --add-port=7777/udp');
      expect(result).toContain('sudo firewall-cmd --permanent --add-port=27015/udp');
      expect(result).toContain('sudo firewall-cmd --permanent --add-port=27020/tcp');
      expect(result).toContain('sudo firewall-cmd --reload');
    });

    it('should skip query port if same as game port', () => {
      const result = getLinuxFirewallInstructions({
        game: 7777,
        query: 7777,
        rcon: 27020
      });

      expect(result).toContain('sudo ufw allow 7777/udp');
      expect(result).not.toContain('sudo ufw allow 7777/udp  # Query port');
      expect(result).toContain('sudo ufw allow 27020/tcp');
    });

    it('should handle missing optional ports', () => {
      const result = getLinuxFirewallInstructions({
        game: 7777
      });

      expect(result).toContain('sudo ufw allow 7777/udp');
      expect(result).not.toContain('27015');
      expect(result).not.toContain('27020');
    });
  });

  describe('getLinuxWebFirewallInstructions', () => {
    it('opens the web port as TCP for ufw and firewalld', () => {
      expect(getLinuxWebFirewallInstructions(3000)).toBe([
        '# Linux Firewall Configuration for Web Server',
        '',
        '# For UFW (Ubuntu/Debian):',
        'sudo ufw allow 3000/tcp  # Web server port',
        '',
        '# For firewalld (CentOS/RHEL/Fedora):',
        'sudo firewall-cmd --permanent --add-port=3000/tcp',
        'sudo firewall-cmd --reload',
        ''
      ].join('\n'));
    });
  });

  // Once for every server: the ranges new servers take their ports from.
  describe('getLinuxServerPortsInstructions', () => {
    it('opens the game and query ranges for UDP with ufw and firewalld, and leaves RCON closed', () => {
      const text = getLinuxServerPortsInstructions(DEFAULT_SERVER_PORT_RANGES);

      expect(text).toContain('sudo ufw allow 7777:7900/udp');
      expect(text).toContain('sudo ufw allow 27015:27030/udp');
      expect(text).toContain('sudo firewall-cmd --permanent --add-port=7777-7900/udp');
      expect(text).toContain('sudo firewall-cmd --permanent --add-port=27015-27030/udp');
      expect(text).toContain('sudo firewall-cmd --reload');
      expect(text).not.toMatch(/27020|tcp/);
    });

    it('writes a one-port range as the port', () => {
      const text = getLinuxServerPortsInstructions({ ...DEFAULT_SERVER_PORT_RANGES, query: { start: 27015, end: 27015 } });
      expect(text).toContain('sudo ufw allow 27015/udp');
      expect(text).toContain('--add-port=27015/udp');
    });
  });
});
