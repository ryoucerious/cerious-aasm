import { getLinuxFirewallInstructions } from '../utils/firewall.utils';
import { getPlatform } from '../utils/platform.utils';

export interface LinuxFirewallInstructionsResult {
  success: boolean;
  instructions?: string;
  platform: string;
  error?: string;
}

/**
 * Firewall Service - Provides Linux firewall configuration instructions
 * Windows firewall is handled automatically by the OS, this service only provides
 * manual configuration instructions for Linux users
 */
export class FirewallService {
  
  /**
   * Get Linux firewall instructions for ARK server ports
   * @param gamePort - The game port for the ARK server
   * @param queryPort - The query port for the ARK server
   * @param rconPort - The RCON port for the ARK server
   * @returns An object containing the success status and firewall instructions
   */
  async getArkServerFirewallInstructions(gamePort: number, queryPort: number, rconPort: number): Promise<LinuxFirewallInstructionsResult> {
    try {
      const instructions = getLinuxFirewallInstructions({ 
        game: gamePort, 
        query: queryPort, 
        rcon: rconPort 
      });
      
      return {
        success: true,
        instructions,
        platform: getPlatform()
      };
    } catch (error) {
      console.error('[firewall-service] Error generating ARK server firewall instructions:', error);
      return {
        success: false,
        platform: getPlatform(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get Linux firewall instructions for web server port
   * @param port - The web server port
   * @returns An object containing the success status and firewall instructions
   */
  async getWebServerFirewallInstructions(port: number): Promise<LinuxFirewallInstructionsResult> {
    try {
      let instructions = `# Linux Firewall Configuration for Web Server\n\n`;
      
      // UFW instructions
      instructions += `# For UFW (Ubuntu/Debian):\n`;
      instructions += `sudo ufw allow ${port}/tcp  # Web server port\n\n`;

      // Firewalld instructions
      instructions += `# For firewalld (CentOS/RHEL/Fedora):\n`;
      instructions += `sudo firewall-cmd --permanent --add-port=${port}/tcp\n`;
      instructions += `sudo firewall-cmd --reload\n`;
      
      return {
        success: true,
        instructions,
        platform: getPlatform()
      };
    } catch (error) {
      console.error('[firewall-service] Error generating web server firewall instructions:', error);
      return {
        success: false,
        platform: getPlatform(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Export singleton instance
export const firewallService = new FirewallService();