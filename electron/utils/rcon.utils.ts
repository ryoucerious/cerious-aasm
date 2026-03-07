// RCON Utilities - Uses the 'rcon' npm package (EventEmitter API)
// Note: Using require() due to lack of proper TypeScript definitions
const Rcon = require('rcon');

export const rconClients: Record<string, any> = {};

// Tracks instances that have an active connection retry loop in progress.
// Prevents multiple concurrent retry chains when connectRcon is called
// again before the previous attempt chain has finished (e.g. player poll
// passive reconnect fires while the initial startup loop is still running).
const rconConnecting = new Set<string>();

/**
 * Connect to RCON for a given instance.
 */
export function connectRcon(instanceId: string, config: any, onStatus?: (connected: boolean) => void) {
  if (rconClients[instanceId]) {
    if (onStatus) onStatus(true);
    return;
  }
  // Already have an active retry loop — don't start another one.
  if (rconConnecting.has(instanceId)) {
    return;
  }
  const port = config.rconPort || 27020;
  // RCON authenticates with ServerAdminPassword — same as the in-game admin password.
  // Fall back to legacy rconPassword field for backward compatibility.
  const password = config.serverAdminPassword || config.rconPassword || '';
  // Use explicit IPv4 loopback — on Linux, 'localhost' may resolve to ::1 (IPv6)
  // which fails if ARK/Wine only binds to IPv4.
  const host = '127.0.0.1';
  // 30 attempts × 3 s = 90 s total window.
  // ARK on Linux/Proton can take 60+ seconds after the "advertising" log line before
  // the RCON port is actually bound, so 30 s (the old 15 × 2 s) was too short.
  const maxAttempts = 30;
  const retryDelayMs = 3000;
  let attempt = 0;

  rconConnecting.add(instanceId);

  function tryConnect() {
    attempt++;
    const rcon = new Rcon(host, port, password);
    let connected = false;
    rcon.on('auth', () => {
      connected = true;
      rconConnecting.delete(instanceId);
      rconClients[instanceId] = rcon;
      if (onStatus) onStatus(true);
    });
    rcon.on('end', () => {
      if (!connected && attempt < maxAttempts) {
        setTimeout(tryConnect, retryDelayMs);
        return;
      }
      rconConnecting.delete(instanceId);
      delete rconClients[instanceId];
      if (onStatus) onStatus(false);
    });
    rcon.on('error', (err: any) => {
      if (!connected && attempt < maxAttempts) {
        // Only log first attempt and every 5th to avoid log spam while server is starting
        if (attempt === 1 || attempt % 5 === 0) {
          console.log(`[RCON] Waiting for server ${instanceId} (attempt ${attempt}/${maxAttempts}): ${err.code || err.message}`);
        }
        setTimeout(tryConnect, retryDelayMs);
        return;
      }
      console.error(`[RCON] All ${maxAttempts} connection attempts failed for ${instanceId}:`, err);
      rconConnecting.delete(instanceId);
      delete rconClients[instanceId];
      if (onStatus) onStatus(false);
    });
    rcon.connect();
  }

  tryConnect();
}

/**
 * Disconnect from RCON for a given instance.
 */
export function disconnectRcon(instanceId: string) {
  rconConnecting.delete(instanceId);
  if (rconClients[instanceId]) {
    try {
      rconClients[instanceId].disconnect();
    } catch (error) {
      console.error(`[rcon-utils] Error disconnecting RCON for ${instanceId}:`, error);
    }
    delete rconClients[instanceId];
  }
}

/**
 * Send an RCON command to a connected instance.
 */
export function sendRconCommand(instanceId: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rcon = rconClients[instanceId];
    if (!rcon) return reject(new Error('RCON not connected'));
    rcon.send(command);
    rcon.once('response', (str: string) => {
      resolve(str);
    });
    rcon.once('error', (err: any) => {
      reject(err);
    });
  });
}

/**
 * Check if RCON is connected for a given instance.
 */
export function isRconConnected(instanceId: string): boolean {
  return !!rconClients[instanceId];
}

/**
 * Check if a RCON connection attempt is currently in progress for a given instance.
 */
export function isRconConnecting(instanceId: string): boolean {
  return rconConnecting.has(instanceId);
}

// Inline exports are used above

/**
 * Cleanup function to disconnect all RCON clients
 * Should be called when the Electron app is shutting down
 */
export function cleanupAllRconConnections(): void {
  Object.keys(rconClients).forEach((instanceId) => {
    disconnectRcon(instanceId);
  });
}
