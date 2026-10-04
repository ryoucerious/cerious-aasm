import * as dgram from 'dgram';
import * as net from 'net';

/** Errors that mean another socket holds the port. Anything else is not the port's fault. */
function isPortTaken(error: NodeJS.ErrnoException, description: string): boolean {
  if (error.code === 'EADDRINUSE' || error.code === 'EACCES') return true;
  console.warn(`[network] Could not test ${description}: ${error.code || error.message}`);
  return false;
}

/**
 * True when UDP `port` cannot be bound on `address`, which is what ARK's game and query ports need.
 * Bind on the address the server will use: Windows lets a wildcard bind succeed next to a socket
 * bound to one address.
 */
export function isUdpPortInUse(port: number, address = '0.0.0.0'): Promise<boolean> {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', (error: NodeJS.ErrnoException) => {
      try {
        socket.close();
      } catch {
        // Never bound, nothing to release
      }
      resolve(isPortTaken(error, `UDP ${address}:${port}`));
    });
    socket.once('listening', () => socket.close(() => resolve(false)));
    socket.bind({ port, address, exclusive: true });
  });
}

/** True when TCP `port` cannot be listened on at `host`, which is what ARK's RCON port needs. */
export function isTcpPortInUse(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', (error: NodeJS.ErrnoException) => resolve(isPortTaken(error, `TCP ${host}:${port}`)));
    server.once('listening', () => server.close(() => resolve(false)));
    server.listen({ port, host, exclusive: true });
  });
}
