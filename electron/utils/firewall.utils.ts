import { exec } from 'child_process';
import { promisify } from 'util';
import { getPlatform } from './platform.utils';
import * as path from 'path';

export const execAsync = promisify(exec);

interface FirewallRule {
  name: string;
  port: number;
  protocol: 'TCP' | 'UDP';
  direction: 'in' | 'out';
  action: 'allow' | 'block';
}

interface FirewallStatus {
  ruleExists: boolean;
  ruleName?: string;
  error?: string;
}

const APP_NAME = 'Cerious AASM';
const ARK_SERVER_RULE_PREFIX = 'ARK Server';

/**
 * Check if Windows Firewall is enabled
 */
export async function isWindowsFirewallEnabled(): Promise<boolean> {
  if (getPlatform() !== 'windows') return false;

  try {
    const { stdout } = await execAsync('netsh advfirewall show allprofiles state');
    return stdout.includes('State                                 ON');
  } catch (error) {
    console.warn('[firewall-utils] Could not check Windows Firewall status:', error);
    return false;
  }
}

/**
 * Check if a firewall rule exists for a specific port
 */
export async function checkFirewallRule(port: number, protocol: 'TCP' | 'UDP' = 'UDP'): Promise<FirewallStatus> {
  if (getPlatform() !== 'windows') {
    return { ruleExists: false, error: 'Not Windows platform' };
  }

  try {
    const ruleName = `${ARK_SERVER_RULE_PREFIX} ${protocol} ${port}`;
    const { stdout } = await execAsync(`netsh advfirewall firewall show rule name="${ruleName}"`);

    const ruleExists = stdout.includes('Rule Name:') && stdout.includes(ruleName);
    return { ruleExists, ruleName: ruleExists ? ruleName : undefined };
  } catch (error) {
    // Rule doesn't exist or error occurred
    return { ruleExists: false };
  }
}

/**
 * Create Windows Firewall rule for a specific port
 */
export async function createFirewallRule(port: number, protocol: 'TCP' | 'UDP' = 'UDP', description?: string): Promise<boolean> {
  if (getPlatform() !== 'windows') {
    return false;
  }

  try {
    const ruleName = `${ARK_SERVER_RULE_PREFIX} ${protocol} ${port}`;
    const desc = description || `Allow ${protocol} traffic on port ${port} for ARK server`;

    const command = `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=${protocol} localport=${port} description="${desc}"`;

    await execAsync(command);

    return true;
  } catch (error) {
    console.error(`[firewall-utils] Failed to create firewall rule for ${protocol} port ${port}:`, error);
    return false;
  }
}

/**
 * Remove Windows Firewall rule for a specific port
 */
export async function removeFirewallRule(port: number, protocol: 'TCP' | 'UDP' = 'UDP'): Promise<boolean> {
  if (getPlatform() !== 'windows') {
    return false;
  }

  try {
    const ruleName = `${ARK_SERVER_RULE_PREFIX} ${protocol} ${port}`;
    const command = `netsh advfirewall firewall delete rule name="${ruleName}"`;
    await execAsync(command);

    return true;
  } catch (error) {
    console.error(`[firewall-utils] Failed to remove firewall rule for ${protocol} port ${port}:`, error);
    return false;
  }
}

/**
 * Create application-based firewall rule (triggers Windows firewall prompt)
 * This allows the entire application to communicate through the firewall
 */
export async function createApplicationRule(applicationPath?: string): Promise<boolean> {
  if (getPlatform() !== 'windows') {
    return false;
  }

  try {
    const appPath = applicationPath || process.execPath;
    const ruleName = `${APP_NAME} Application`;

    // Remove existing rule first
    try {
      await execAsync(`netsh advfirewall firewall delete rule name="${ruleName}"`);
    } catch {
      // Ignore if rule doesn't exist
    }

    const command = `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow program="${appPath}" description="Allow ${APP_NAME} application network access"`;

    await execAsync(command);

    return true;
  } catch (error) {
    console.error(`[firewall-utils] Failed to create application firewall rule:`, error);
    return false;
  }
}

/**
 * Setup firewall rules for ARK server (Game + Query + RCON ports)
 */
export async function setupArkServerFirewall(gamePort: number, queryPort?: number, rconPort?: number): Promise<{
  success: boolean;
  rulesCreated: string[];
  errors: string[];
}> {
  const rulesCreated: string[] = [];
  const errors: string[] = [];

  // Game port (UDP)
  if (await createFirewallRule(gamePort, 'UDP', `ARK Server Game Port ${gamePort}`)) {
    rulesCreated.push(`Game UDP ${gamePort}`);
  } else {
    errors.push(`Failed to create game port rule (UDP ${gamePort})`);
  }

  // Query port (UDP)
  if (queryPort && queryPort !== gamePort) {
    if (await createFirewallRule(queryPort, 'UDP', `ARK Server Query Port ${queryPort}`)) {
      rulesCreated.push(`Query UDP ${queryPort}`);
    } else {
      errors.push(`Failed to create query port rule (UDP ${queryPort})`);
    }
  }

  // RCON port (TCP)
  if (rconPort) {
    if (await createFirewallRule(rconPort, 'TCP', `ARK Server RCON Port ${rconPort}`)) {
      rulesCreated.push(`RCON TCP ${rconPort}`);
    } else {
      errors.push(`Failed to create RCON port rule (TCP ${rconPort})`);
    }
  }

  return {
    success: errors.length === 0,
    rulesCreated,
    errors
  };
}

/**
 * Setup firewall rule for web server
 */
export async function setupWebServerFirewall(port: number): Promise<boolean> {
  return await createFirewallRule(port, 'TCP', `${APP_NAME} Web Server Port ${port}`);
}

/**
 * Check if user has administrator privileges (required for firewall changes)
 */
export async function hasAdminPrivileges(): Promise<boolean> {
  if (getPlatform() !== 'windows') {
    return false;
  }

  try {
    // Try to run a command that requires admin privileges
    await execAsync('net session');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all existing ARK server firewall rules
 */
export async function getExistingArkRules(): Promise<string[]> {
  if (getPlatform() !== 'windows') {
    return [];
  }

  try {
    const { stdout } = await execAsync('netsh advfirewall firewall show rule name=all');
    const lines = stdout.split('\n');
    const arkRules: string[] = [];

    for (const line of lines) {
      if (line.includes('Rule Name:') && line.includes(ARK_SERVER_RULE_PREFIX)) {
        const ruleName = line.replace('Rule Name:', '').trim();
        arkRules.push(ruleName);
      }
    }

    return arkRules;
  } catch (error) {
    console.error('[firewall-utils] Failed to get existing ARK rules:', error);
    return [];
  }
}

/**
 * Clean up all ARK server firewall rules
 */
export async function cleanupArkRules(): Promise<boolean> {
  if (getPlatform() !== 'windows') {
    return false;
  }

  try {
    const existingRules = await getExistingArkRules();

    for (const ruleName of existingRules) {
      try {
        await execAsync(`netsh advfirewall firewall delete rule name="${ruleName}"`);
      } catch (error) {
        console.warn(`[firewall-utils] Failed to remove rule ${ruleName}:`, error);
      }
    }

    return true;
  } catch (error) {
    console.error('[firewall-utils] Failed to cleanup ARK firewall rules:', error);
    return false;
  }
}

/**
 * Provide Linux firewall guidance
 */
export function getLinuxFirewallInstructions(ports: { game: number; query?: number; rcon?: number }): string {
  const { game, query, rcon } = ports;

  let instructions = `# Linux Firewall Configuration for ARK Server\n\n`;

  // UFW instructions
  instructions += `# For UFW (Ubuntu/Debian):\n`;
  instructions += `sudo ufw allow ${game}/udp  # Game port\n`;
  if (query && query !== game) {
    instructions += `sudo ufw allow ${query}/udp  # Query port\n`;
  }
  if (rcon) {
    instructions += `sudo ufw allow ${rcon}/tcp  # RCON port\n`;
  }
  instructions += `\n`;

  // Firewalld instructions
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