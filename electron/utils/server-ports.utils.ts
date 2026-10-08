import { DEFAULT_SERVER_PORT_RANGES, parseServerPortRanges, type ServerPortRanges } from './ark/port-sets';
import { getDockerNetworkInfo, type DockerNetworkInfo } from './docker-network.utils';
import { loadGlobalConfig, type GlobalConfig } from './global-config.utils';

/** `docker`: set in docker-compose.yml, which publishes them. `settings`: this machine's Settings. */
export type ServerPortsSource = 'docker' | 'settings';

/**
 * The ranges this machine's servers take their ports from. In Docker only the published ranges
 * reach the container, so they win over Settings.
 */
export function getServerPortRanges(
  config: GlobalConfig = loadGlobalConfig(),
  docker: DockerNetworkInfo | null = getDockerNetworkInfo()
): { ranges: ServerPortRanges; source: ServerPortsSource } {
  if (docker) {
    return { ranges: { game: docker.gamePorts, query: docker.queryPorts, rcon: docker.rconPorts }, source: 'docker' };
  }
  const parsed = config.serverPorts ? parseServerPortRanges(config.serverPorts) : null;
  return { ranges: parsed && 'ranges' in parsed ? parsed.ranges : DEFAULT_SERVER_PORT_RANGES, source: 'settings' };
}
