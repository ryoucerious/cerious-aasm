// RCON Utilities - Uses the 'rcon' npm package (EventEmitter API)
// Note: Using require() due to lack of proper TypeScript definitions
const Rcon = require('rcon');

export const rconClients: Record<string, any> = {};

/**
 * Connect to RCON for a given instance.
 */
export function connectRcon(instanceId: string, config: any, onStatus?: (connected: boolean) => void) {
  if (rconClients[instanceId]) {
    if (onStatus) onStatus(true);
    return;
  }
  const port = config.rconPort || 27020;
  const password = config.rconPassword || '';
  const host = 'localhost';
  const maxAttempts = 15; // 15 attempts (30s total)
  let attempt = 0;

  function tryConnect() {
    attempt++;
    const rcon = new Rcon(host, port, password);
    let connected = false;
    rcon.on('auth', () => {
      connected = true;
      rconClients[instanceId] = rcon;
      if (onStatus) onStatus(true);
    });
    rcon.on('end', () => {
      if (!connected && attempt < maxAttempts) {
        setTimeout(tryConnect, 2000);
        return;
      }
      delete rconClients[instanceId];
      if (onStatus) onStatus(false);
    });
    rcon.on('error', (err: any) => {
      if (!connected && attempt < maxAttempts) {
        console.error(`[RCON] ERROR (will retry) for instanceId=${instanceId}:`, err);
        setTimeout(tryConnect, 2000);
        return;
      }
      console.error(`[RCON] ERROR for instanceId=${instanceId}:`, err);
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
