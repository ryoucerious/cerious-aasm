import { firewallService } from '../services/firewall.service';
import { getPlatform } from '../utils/platform.utils';
import { getDockerNetworkInfo } from '../utils/docker-network.utils';
import { onRequest } from './handler.utils';

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
  return {
    success: true,
    platform,
    enabled,
    message: enabled ? 'Firewall management available on Linux' : 'Firewall management not available on this platform',
    ...(docker ? { docker } : {})
  };
}, {
  fallbackError: CHECK_FAILURE,
  onError: error => ({ success: false, platform: getPlatform(), enabled: false, message: CHECK_FAILURE, error })
});
