/**
 * Fixed ASA port sets. A new server takes the lowest free set.
 * Players never choose these ports, and a save cannot move a server off its set.
 *
 * Set n (1-based) is the defaults plus (n - 1) * 10:
 *   game 7777, peer game+1, query 27015, rcon 27020.
 * Twenty-five sets stay clear of each other. The peer port is not stored;
 * the launch command always uses game + 1.
 */

export const PORT_SET_COUNT = 25;
export const PORT_SET_STRIDE = 10;
export const GAME_PORT_BASE = 7777;
export const QUERY_PORT_BASE = 27015;
export const RCON_PORT_BASE = 27020;

export interface PortSet {
  /** 1-based set number. */
  index: number;
  gamePort: number;
  peerPort: number;
  queryPort: number;
  rconPort: number;
}

export function portSet(index: number): PortSet {
  if (!Number.isInteger(index) || index < 1 || index > PORT_SET_COUNT) {
    throw new Error(`Port set ${index} is outside 1-${PORT_SET_COUNT}`);
  }
  const offset = (index - 1) * PORT_SET_STRIDE;
  const gamePort = GAME_PORT_BASE + offset;
  return {
    index,
    gamePort,
    peerPort: gamePort + 1,
    queryPort: QUERY_PORT_BASE + offset,
    rconPort: RCON_PORT_BASE + offset
  };
}

export function allPortSets(): PortSet[] {
  return Array.from({ length: PORT_SET_COUNT }, (_, i) => portSet(i + 1));
}

/** The set whose game port this is, or null when the number is not one of the 25. */
export function portSetForGamePort(gamePort: number | string | undefined | null): PortSet | null {
  const n = Number(gamePort);
  if (!Number.isInteger(n)) return null;
  const delta = n - GAME_PORT_BASE;
  if (delta < 0 || delta % PORT_SET_STRIDE !== 0) return null;
  const index = delta / PORT_SET_STRIDE + 1;
  if (index < 1 || index > PORT_SET_COUNT) return null;
  return portSet(index);
}

export function portsMatchSet(
  gamePort: number | string | undefined | null,
  queryPort: number | string | undefined | null,
  rconPort: number | string | undefined | null
): boolean {
  const set = portSetForGamePort(gamePort);
  if (!set) return false;
  return Number(queryPort) === set.queryPort && Number(rconPort) === set.rconPort;
}

/** Lowest set whose game port is not already taken by a canonical assignment. */
export function nextPortSet(usedGamePorts: Array<number | string | undefined | null>): PortSet | null {
  const used = new Set<number>();
  for (const port of usedGamePorts) {
    const set = portSetForGamePort(port);
    if (set) used.add(set.gamePort);
  }
  return allPortSets().find(set => !used.has(set.gamePort)) || null;
}

export interface PortSetCarrier {
  id?: string;
  name?: string;
  gamePort?: number | string;
  queryPort?: number | string;
  rconPort?: number | string;
}

/**
 * Keep servers that already sit on a complete set. Assign the lowest free set
 * to the rest, in the order given. Returns the ids whose ports changed.
 */
export function reconcilePortSets<T extends PortSetCarrier>(instances: T[]): { instances: T[]; changedIds: string[] } {
  const next = instances.map(instance => ({ ...instance }));
  const used = new Set<number>();
  for (const instance of next) {
    if (portsMatchSet(instance.gamePort, instance.queryPort, instance.rconPort)) {
      used.add(Number(instance.gamePort));
    }
  }
  const changedIds: string[] = [];
  for (const instance of next) {
    if (portsMatchSet(instance.gamePort, instance.queryPort, instance.rconPort)) continue;
    const free = allPortSets().find(set => !used.has(set.gamePort));
    if (!free) continue;
    instance.gamePort = free.gamePort;
    instance.queryPort = free.queryPort;
    instance.rconPort = free.rconPort;
    used.add(free.gamePort);
    if (instance.id) changedIds.push(instance.id);
  }
  return { instances: next, changedIds };
}
