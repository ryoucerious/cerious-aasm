import * as net from 'net';
import * as http from 'http';
import * as dgram from 'dgram';

/**
 * True when another process already has this UDP port. Game and query ports are UDP.
 * A TCP listener on the same number, including ARK's localhost HTTP socket on 8888,
 * does not count.
 */
export function isUdpPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const finish = (inUse: boolean) => {
      socket.removeAllListeners();
      try {
        socket.close();
      } catch {
        // The socket is already closed after a bind error.
      }
      resolve(inUse);
    };
    socket.once('error', () => finish(true));
    socket.once('listening', () => finish(false));
    try {
      socket.bind({ port, exclusive: true });
    } catch {
      finish(true);
    }
  });
}

export function isPortInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    // For web server ports, try HTTP request instead of just TCP connection
    // This ensures we're checking if the web server is actually responding
    if (port >= 3000 && port <= 9999) {
      const req = http.request({
        hostname: host,
        port: port,
        method: 'GET',
        path: '/',
        timeout: 2000
      }, (res) => {
        req.destroy();
        resolve(true); // Server is responding
      });
      
      req.on('error', (err: any) => {
        req.destroy();
        // If it's a connection refused, the port is not in use
        // If it's any other error (like 401, 404, etc.), the server is running
        resolve(err.code !== 'ECONNREFUSED');
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      
      req.end();
    } else {
      // For other ports, use original TCP socket method
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('error', (err: any) => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    }
  });
}
