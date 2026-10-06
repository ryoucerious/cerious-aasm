// Live state per instance for this app run; nothing here is persisted.
const instanceStates: Record<string, string> = {};

export function setInstanceState(instanceId: string, state: string): void {
  instanceStates[instanceId] = state;
}

export function getInstanceState(instanceId: string): string | null {
  return instanceStates[instanceId] || null;
}

/** The state, with 'stopped' for an instance that has not run since the app started. */
export function getNormalizedInstanceState(instanceId: string): string {
  return getInstanceState(instanceId) || 'stopped';
}

export const SERVER_FILES_UPDATING = 'The ARK server files are being installed or updated. Start the server once that has finished.';

let serverFilesUpdates = 0;

/** Runs `work` (an install or update of the shared server files) with server starts refused until it settles. */
export async function whileServerFilesUpdate<T>(work: () => Promise<T>): Promise<T> {
  serverFilesUpdates++;
  try {
    return await work();
  } finally {
    serverFilesUpdates--;
  }
}

export function areServerFilesUpdating(): boolean {
  return serverFilesUpdates > 0;
}

export const SERVER_BEING_MOVED = 'That server is being moved to another machine. Start it there once the move has finished.';

const movingServers = new Set<string>();

/**
 * Runs `work` (copying a server to another machine) with starts of that server refused until it
 * settles: a start meanwhile would leave the copy here and the one there to diverge.
 */
export async function whileServerMoves<T>(instanceId: string, work: () => Promise<T>): Promise<T> {
  movingServers.add(instanceId);
  try {
    return await work();
  } finally {
    movingServers.delete(instanceId);
  }
}

export function isServerMoving(instanceId: string): boolean {
  return movingServers.has(instanceId);
}
