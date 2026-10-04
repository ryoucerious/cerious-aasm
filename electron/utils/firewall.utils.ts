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