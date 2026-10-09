import { firewallService } from '../services/firewall.service';
import { getPlatform } from '../utils/platform.utils';
import { getDockerNetworkInfo } from '../utils/docker-network.utils';
import { onRequest } from './handler.utils';
import { serverPortsService } from '../services/server-ports.service';
import { getServerPortRanges } from '../utils/server-ports.utils';
import { identifySender, isDesktopWindow } from '../services/auth/permission-gate';
import { localNode } from '../services/mesh/mesh-hooks';
import { PERMISSIONS, ROLE_IDS } from '../types/auth.types';
import type { MessageSender } from '../types/messaging.types';

const ARK_FAILURE = 'Failed to generate ARK server firewall instructions';
const WEB_FAILURE = 'Failed to generate web server firewall instructions';
const CHECK_FAILURE = 'Failed to check firewall status';

onRequest('setup-ark-server-firewall', async payload => {
  const { gamePort, queryPort, rconPort } = payload;
  const result = await firewallService.getArkServerFirewallInstructions(gamePort, queryPort, rconPort);
  return {
    success: result.success,
    platform: result.platform,
    instructions: result.instructions,
    message: result.success ? 'Linux firewall configuration instructions provided' : 'Failed to generate firewall instructions',
    error: result.error
  };
}, {
  fallbackError: ARK_FAILURE,
  onError: error => ({ success: false, platform: getPlatform(), message: ARK_FAILURE, error })
});

onRequest('setup-web-server-firewall', async payload => {
  const { port } = payload;
  const result = await firewallService.getWebServerFirewallInstructions(port);
  return {
    success: result.success,
    platform: result.platform,
    instructions: result.instructions,
    message: result.success ? `Linux firewall configuration instructions for port ${port} provided` : WEB_FAILURE,
    error: result.error
  };
}, {
  fallbackError: WEB_FAILURE,
  onError: error => ({ success: false, platform: getPlatform(), message: WEB_FAILURE, error })
});

onRequest('get-linux-firewall-instructions', async payload => {
  const { gamePort, queryPort, rconPort } = payload;
  const { success, instructions, platform, error } = await firewallService.getArkServerFirewallInstructions(gamePort, queryPort, rconPort);
  return { success, instructions, platform, error };
}, {
  fallbackError: 'Failed to get Linux firewall instructions',
  onError: error => ({ success: false, platform: getPlatform(), error })
});

onRequest('check-firewall-enabled', () => {
  const platform = getPlatform();
  const enabled = platform === 'linux';
  // In Docker the ports are decided by how the container is networked, not by ufw inside it.
  const docker = getDockerNetworkInfo();
  // Where this machine's servers take their ports from, and whether its firewall lets players
  // reach them (known on Windows once read), for each server's Firewall tab.
  const { ranges, source } = getServerPortRanges();
  return {
    success: true,
    platform,
    enabled,
    message: enabled ? 'Firewall management available on Linux' : 'Firewall management not available on this platform',
    ...(docker ? { docker } : {}),
    serverPorts: { ranges, source, portsOpen: serverPortsService.portsOpen() }
  };
}, {
  fallbackError: CHECK_FAILURE,
  onError: error => ({ success: false, platform: getPlatform(), enabled: false, message: CHECK_FAILURE, error })
});

// Settings → Server Defaults → Server Ports: the ranges this machine's servers take their ports from.
onRequest('get-server-ports', () => serverPortsService.state(), { fallbackError: 'Could not read the server ports' });

const NOT_YOURS = 'Only an Admin, or the Machine Admin of this machine, can change its server ports.';

/** The machine's own settings: whoever manages settings, or the Machine Admin who looks after this machine. */
function maySetServerPorts(sender: MessageSender): boolean {
  const identity = identifySender(sender);
  if (identity.isAdmin || identity.permissions.includes(PERMISSIONS.SETTINGS_MANAGE)) return true;
  const user = identity.user;
  return user?.roleId === ROLE_IDS.MACHINE_ADMIN && !!user.machineNodeId && user.machineNodeId === localNode();
}

onRequest('set-server-ports', (payload, { sender }) => {
  if (!maySetServerPorts(sender)) return { success: false, error: NOT_YOURS };
  return serverPortsService.setRanges(payload.ranges);
}, { fallbackError: 'Could not save the server ports' });

// Windows asks for permission on this machine's screen, where a web client's user may not be.
onRequest('open-server-ports-firewall', (_payload, { sender }) => {
  if (!maySetServerPorts(sender)) return { success: false, error: NOT_YOURS };
  if (!isDesktopWindow(sender)) {
    return { success: false, error: 'Open the ports from the desktop app on this machine: Windows asks for permission on its screen.' };
  }
  return serverPortsService.openFirewall();
}, { fallbackError: 'Could not open the ports in Windows Firewall' });
