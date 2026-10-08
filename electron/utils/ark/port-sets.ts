/**
 * The ports of servers that share one machine.
 *
 * Each machine has ranges its servers' ports come from (see ServerPortRanges): what its firewall
 * opens, or what Docker publishes. A new server takes the lowest free ports inside them. The peer
 * port is never stored; the launch command always uses game + 1, so it shares the game range.
 */

import type { PortRange } from '../docker-network.utils';

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

/** Where a machine's servers take their ports from. Game covers the peer port too. */
export interface ServerPortRanges {
  game: PortRange;
  query: PortRange;
  rcon: PortRange;
}

/** The ranges docker-compose.yml publishes, so a machine and the Docker image start alike. */
export const DEFAULT_SERVER_PORT_RANGES: ServerPortRanges = {
  game: { start: 7777, end: 7900 },
  query: { start: 27015, end: 27030 },
  rcon: { start: 27020, end: 27050 }
};

/** A port of a server that falls outside the range it has to be in. */
export interface PortOutsideRange {
  label: 'Game' | 'Peer' | 'Query' | 'RCON';
  port: number;
  protocol: 'UDP' | 'TCP';
  range: PortRange;
}

const inside = (port: number, range: PortRange) => port >= range.start && port <= range.end;

/** Every port of `carrier` outside its range. Missing ports count as ARK's defaults. */
export function portsOutsideRanges(carrier: PortCarrier, ranges: ServerPortRanges): PortOutsideRange[] {
  const game = portOf(carrier.gamePort, DEFAULT_GAME_PORT);
  const checks: PortOutsideRange[] = [
    { label: 'Game', port: game, protocol: 'UDP', range: ranges.game },
    { label: 'Peer', port: game + 1, protocol: 'UDP', range: ranges.game },
    { label: 'Query', port: portOf(carrier.queryPort, DEFAULT_QUERY_PORT), protocol: 'UDP', range: ranges.query },
    { label: 'RCON', port: portOf(carrier.rconPort, DEFAULT_RCON_PORT), protocol: 'TCP', range: ranges.rcon }
  ];
  return checks.filter(check => !inside(check.port, check.range));
}

const FIELD_OF: Record<PortOutsideRange['label'], keyof PortCarrier> = { Game: 'gamePort', Peer: 'gamePort', Query: 'queryPort', RCON: 'rconPort' };

/**
 * The ports outside their range that an edit changed. A port a server already had outside them is
 * left alone: servers from before the ranges, or moved since they changed, keep working.
 */
export function changedPortsOutsideRanges(before: PortCarrier, after: PortCarrier, ranges: ServerPortRanges): PortOutsideRange[] {
  return portsOutsideRanges(after, ranges).filter(outside => {
    const field = FIELD_OF[outside.label];
    return Number(after[field]) !== Number(before[field]);
  });
}

/**
 * The lowest ports inside `ranges` that none of `others` uses, or null when a range has none
 * left. The query port also stays off the game and peer ports chosen here, both being UDP.
 */
export function nextFreePortsIn(ranges: ServerPortRanges, others: PortCarrier[]): PortSet | null {
  const udp = new Set(others.flatMap(udpPorts));
  const tcp = new Set(others.flatMap(tcpPorts));
  let gamePort: number | null = null;
  for (let port = ranges.game.start; port < ranges.game.end; port++) {
    if (!udp.has(port) && !udp.has(port + 1)) {
      gamePort = port;
      break;
    }
  }
  if (gamePort === null) return null;
  const taken = new Set([...udp, gamePort, gamePort + 1]);
  const queryPort = firstFree(ranges.query, taken);
  const rconPort = firstFree(ranges.rcon, tcp);
  if (queryPort === null || rconPort === null) return null;
  return { gamePort, peerPort: gamePort + 1, queryPort, rconPort };
}

function firstFree(range: PortRange, taken: Set<number>): number | null {
  for (let port = range.start; port <= range.end; port++) {
    if (!taken.has(port)) return port;
  }
  return null;
}

const RANGE_NAMES: Array<[keyof ServerPortRanges, string]> = [['game', 'game'], ['query', 'query'], ['rcon', 'RCON']];

/** Ranges as typed into Settings: numbers or numeric strings. The reason when they cannot be used. */
export function parseServerPortRanges(input: unknown): { ranges: ServerPortRanges } | { error: string } {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const ranges = {} as ServerPortRanges;
  for (const [key] of RANGE_NAMES) {
    const range = source[key] as { start?: unknown; end?: unknown } | undefined;
    if (!range || typeof range !== 'object') return { error: 'Give a range for the game, query and RCON ports.' };
    ranges[key] = { start: Number(range.start), end: Number(range.end) };
  }
  for (const [key, name] of RANGE_NAMES) {
    const { start, end } = ranges[key];
    if (![start, end].every(port => Number.isInteger(port) && port >= 1 && port <= 65535)) return { error: 'Ports run from 1 to 65535.' };
    if (end < start) return { error: `The ${name} ports end before they start.` };
  }
  if (ranges.game.end === ranges.game.start) {
    return { error: 'The game ports need at least two ports: each server also uses the one after its game port.' };
  }
  if (ranges.game.start <= ranges.query.end && ranges.query.start <= ranges.game.end) {
    return { error: 'The game and query ports overlap. Both are UDP, so each needs a range of its own.' };
  }
  return { ranges };
}
