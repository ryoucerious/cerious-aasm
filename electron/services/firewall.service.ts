import { getLinuxFirewallInstructions, getLinuxWebFirewallInstructions } from '../utils/firewall.utils';
import { getPlatform } from '../utils/platform.utils';
import { parsePort } from '../utils/validation.utils';

export interface LinuxFirewallInstructionsResult {
  success: boolean;
  instructions?: string;
  platform: string;
  error?: string;
}

const INVALID_PORT = 'Invalid port';

// Unset optional ports are left out; anything else must be a port, since the text is meant to be
// pasted into a root shell.
function optionalPort(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  return parsePort(value) ?? null;
}

/**
 * Firewall instructions for Linux users to follow by hand. Windows asks the user itself the first
 * time a server listens.
 */
export class FirewallService {
  async getArkServerFirewallInstructions(gamePort: unknown, queryPort: unknown, rconPort: unknown): Promise<LinuxFirewallInstructionsResult> {
    const platform = getPlatform();
    const game = parsePort(gamePort);
    const query = optionalPort(queryPort);
    const rcon = optionalPort(rconPort);
    if (game === undefined || query === null || rcon === null) {
      return { success: false, platform, error: INVALID_PORT };
    }
    return { success: true, platform, instructions: getLinuxFirewallInstructions({ game, query, rcon }) };
  }

  async getWebServerFirewallInstructions(port: unknown): Promise<LinuxFirewallInstructionsResult> {
    const platform = getPlatform();
    const webPort = parsePort(port);
    if (webPort === undefined) {
      return { success: false, platform, error: INVALID_PORT };
    }
    return { success: true, platform, instructions: getLinuxWebFirewallInstructions(webPort) };
  }
}

export const firewallService = new FirewallService();