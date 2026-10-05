/**
 * Port sets for servers that share one machine.
 *
 * Set n is the ASA defaults plus (n - 1) * 10: game 7777, peer game + 1, query 27015, RCON 27020.
 * Ten apart keeps every port of one set clear of the next. The peer port is never stored; the
 * launch command always uses game + 1.
 */

export const PORT_SET_COUNT = 25;
const PORT_SET_STRIDE = 10;
const DEFAULT_GAME_PORT = 7777;
const DEFAULT_QUERY_PORT = 27015;
const DEFAULT_RCON_PORT = 27020;

export interface PortSet {
  gamePort: number;
  peerPort: number;
  queryPort: number;
  rconPort: number;
}

/** The ports an instance config carries. Missing ones mean ARK's defaults. */
export interface PortCarrier {
  name?: string;
  gamePort?: number | string;
  queryPort?: number | string;
  rconPort?: number | string;
}

export interface PortConflict {
  port: number;
  protocol: 'UDP' | 'TCP';
  /** The other server's name, or its id when it has none. */
  name: string;
}

/** The 1-based set `index`. */
export function portSet(index: number): PortSet {
  if (!Number.isInteger(index) || index < 1 || index > PORT_SET_COUNT) {
    throw new Error(`Port set ${index} is outside 1-${PORT_SET_COUNT}`);
  }
  const offset = (index - 1) * PORT_SET_STRIDE;
  const gamePort = DEFAULT_GAME_PORT + offset;
  return {
    gamePort,
    peerPort: gamePort + 1,
    queryPort: DEFAULT_QUERY_PORT + offset,
    rconPort: DEFAULT_RCON_PORT + offset
  };
}

function portOf(value: number | string | undefined, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

/** Game, peer and query: what the server binds over UDP. */
function udpPorts(carrier: PortCarrier): number[] {
  const game = portOf(carrier.gamePort, DEFAULT_GAME_PORT);
  return [game, game + 1, portOf(carrier.queryPort, DEFAULT_QUERY_PORT)];
}

function tcpPorts(carrier: PortCarrier): number[] {
  return [portOf(carrier.rconPort, DEFAULT_RCON_PORT)];
}

/**
 * The first port of `candidate` that one of `others` already binds, or null. UDP and TCP are
 * separate namespaces, so a query port may equal another server's RCON port.
 */
export function findPortConflict(candidate: PortCarrier, others: Array<PortCarrier & { id?: string }>): PortConflict | null {
  for (const other of others) {
    const name = other.name || other.id || 'another server';
    const theirUdp = new Set(udpPorts(other));
    const udp = udpPorts(candidate).find(port => theirUdp.has(port));
    if (udp !== undefined) return { port: udp, protocol: 'UDP', name };
    const theirTcp = new Set(tcpPorts(other));
    const tcp = tcpPorts(candidate).find(port => theirTcp.has(port));
    if (tcp !== undefined) return { port: tcp, protocol: 'TCP', name };
  }
  return null;
}

/** The lowest set none of `others` touches, or null when all 25 are in use. */
export function nextFreePortSet(others: Array<PortCarrier & { id?: string }>): PortSet | null {
  for (let index = 1; index <= PORT_SET_COUNT; index++) {
    const set = portSet(index);
    if (!findPortConflict(set, others)) return set;
  }
  return null;
}
