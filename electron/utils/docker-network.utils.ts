import { isRunningInDocker } from './platform.utils';
import { DEFAULT_SERVER_PORT_RANGES } from './ark/port-sets';

export interface PortRange {
  start: number;
  end: number;
}

/**
 * How the Docker image reaches the network, for the Firewall page.
 *
 * `published`: bridge networking. Only the ranges docker-compose.yml publishes reach the
 * container, and Docker's own rules open them on the host ahead of ufw.
 * `host`: the container shares the host's network (docker-compose.host.yml), so every port
 * is reachable and the host firewall decides.
 */
export interface DockerNetworkInfo {
  mode: 'published' | 'host';
  gamePorts: PortRange;
  queryPorts: PortRange;
  rconPorts: PortRange;
  webPort: number;
}

// The defaults in docker-compose.yml. Compose passes the same variables it publishes, so an
// image started some other way still describes the standard setup.
const DEFAULT_GAME_PORTS: PortRange = DEFAULT_SERVER_PORT_RANGES.game;
const DEFAULT_QUERY_PORTS: PortRange = DEFAULT_SERVER_PORT_RANGES.query;
const DEFAULT_RCON_PORTS: PortRange = DEFAULT_SERVER_PORT_RANGES.rcon;
const DEFAULT_WEB_PORT = 3000;

const isPort = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535;

/** "7777-7900" or "27020". Anything else falls back, since the page would otherwise mislead. */
export function parsePortRange(value: string | undefined, fallback: PortRange): PortRange {
  const text = (value || '').trim();
  if (!text) return fallback;
  const match = /^(\d+)(?:-(\d+))?$/.exec(text);
  const start = match ? Number(match[1]) : NaN;
  const end = match ? Number(match[2] ?? match[1]) : NaN;
  if (!isPort(start) || !isPort(end) || end < start) {
    console.warn(`[docker-network] Ignoring port range "${text}"; expected e.g. 7777-7900`);
    return fallback;
  }
  return { start, end };
}

/** Null outside Docker. */
export function getDockerNetworkInfo(
  inDocker: boolean = isRunningInDocker(),
  env: NodeJS.ProcessEnv = process.env
): DockerNetworkInfo | null {
  if (!inDocker) return null;
  const webPort = Number(env.AASM_PORT);
  return {
    mode: (env.AASM_NETWORK || '').trim().toLowerCase() === 'host' ? 'host' : 'published',
    gamePorts: parsePortRange(env.AASM_GAME_PORTS, DEFAULT_GAME_PORTS),
    queryPorts: parsePortRange(env.AASM_QUERY_PORTS, DEFAULT_QUERY_PORTS),
    rconPorts: parsePortRange(env.AASM_RCON_PORTS, DEFAULT_RCON_PORTS),
    webPort: isPort(webPort) ? webPort : DEFAULT_WEB_PORT
  };
}
