import type { ServerPortRanges } from './ark/port-sets';
import type { PortRange } from './docker-network.utils';

/** Commands a Linux user can run to open an ARK server's ports with ufw or firewalld. */
export function getLinuxFirewallInstructions(ports: { game: number; query?: number; rcon?: number }): string {
  const { game, query, rcon } = ports;

  let instructions = `# Linux Firewall Configuration for ARK Server\n\n`;

  instructions += `# For UFW (Ubuntu/Debian):\n`;
  instructions += `sudo ufw allow ${game}/udp  # Game port\n`;
  if (query && query !== game) {
    instructions += `sudo ufw allow ${query}/udp  # Query port (Steam discovery)\n`;
  }
  if (rcon) {
    instructions += `sudo ufw allow ${rcon}/tcp  # RCON port\n`;
  }
  instructions += `\n`;

  instructions += `# For firewalld (CentOS/RHEL/Fedora):\n`;
  instructions += `sudo firewall-cmd --permanent --add-port=${game}/udp\n`;
  if (query && query !== game) {
    instructions += `sudo firewall-cmd --permanent --add-port=${query}/udp\n`;
  }
  if (rcon) {
    instructions += `sudo firewall-cmd --permanent --add-port=${rcon}/tcp\n`;
  }
  instructions += `sudo firewall-cmd --reload\n`;

  return instructions;
}

/** The same for the web UI's port. */
export function getLinuxWebFirewallInstructions(port: number): string {
  let instructions = `# Linux Firewall Configuration for Web Server\n\n`;

  instructions += `# For UFW (Ubuntu/Debian):\n`;
  instructions += `sudo ufw allow ${port}/tcp  # Web server port\n\n`;

  instructions += `# For firewalld (CentOS/RHEL/Fedora):\n`;
  instructions += `sudo firewall-cmd --permanent --add-port=${port}/tcp\n`;
  instructions += `sudo firewall-cmd --reload\n`;

  return instructions;
}

/**
 * Commands that open this machine's server ports once for every server: the game range (with the
 * peer ports) and the query range, over UDP. RCON stays closed; the panel reaches it locally.
 */
export function getLinuxServerPortsInstructions({ game, query }: ServerPortRanges): string {
  const ufw = ({ start, end }: PortRange) => (start === end ? `${start}` : `${start}:${end}`);
  const firewalld = ({ start, end }: PortRange) => (start === end ? `${start}` : `${start}-${end}`);
  return [
    '# UFW (Ubuntu/Debian):',
    `sudo ufw allow ${ufw(game)}/udp  # Game and peer ports`,
    `sudo ufw allow ${ufw(query)}/udp  # Query ports`,
    '',
    '# firewalld (Fedora/RHEL):',
    `sudo firewall-cmd --permanent --add-port=${firewalld(game)}/udp`,
    `sudo firewall-cmd --permanent --add-port=${firewalld(query)}/udp`,
    'sudo firewall-cmd --reload',
    ''
  ].join('\n');
}
