import { EventEmitter } from 'events';
import { isTcpPortInUse, isUdpPortInUse } from './network.utils';

jest.mock('dgram', () => ({ createSocket: jest.fn() }));
jest.mock('net', () => ({ createServer: jest.fn() }));

const mockDgram = jest.requireMock('dgram') as { createSocket: jest.Mock };
const mockNet = jest.requireMock('net') as { createServer: jest.Mock };

class FakeSocket extends EventEmitter {
  bind = jest.fn();
  close = jest.fn((callback?: () => void) => callback?.());
}

class FakeServer extends EventEmitter {
  listen = jest.fn();
  close = jest.fn((callback?: () => void) => callback?.());
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('network.utils', () => {
  describe('isUdpPortInUse', () => {
    let socket: FakeSocket;

    beforeEach(() => {
      socket = new FakeSocket();
      mockDgram.createSocket.mockReturnValue(socket);
    });

    it('binds an IPv4 UDP socket exclusively on the given address', async () => {
      socket.bind.mockImplementation(() => socket.emit('listening'));

      await isUdpPortInUse(7777, '10.0.0.5');

      expect(mockDgram.createSocket).toHaveBeenCalledWith('udp4');
      expect(socket.bind).toHaveBeenCalledWith({ port: 7777, address: '10.0.0.5', exclusive: true });
    });

    it('binds every interface when no address is given', async () => {
      socket.bind.mockImplementation(() => socket.emit('listening'));

      await isUdpPortInUse(27015);

      expect(socket.bind).toHaveBeenCalledWith({ port: 27015, address: '0.0.0.0', exclusive: true });
    });

    it('reports a free port and releases it', async () => {
      socket.bind.mockImplementation(() => socket.emit('listening'));

      await expect(isUdpPortInUse(7777)).resolves.toBe(false);
      expect(socket.close).toHaveBeenCalled();
    });

    it.each(['EADDRINUSE', 'EACCES'])('reports a port it cannot bind with %s as in use', async code => {
      socket.bind.mockImplementation(() => socket.emit('error', errno(code)));

      await expect(isUdpPortInUse(7777)).resolves.toBe(true);
      expect(socket.close).toHaveBeenCalled();
    });

    it('does not block a start on an error that says nothing about the port', async () => {
      socket.bind.mockImplementation(() => socket.emit('error', errno('EADDRNOTAVAIL')));

      await expect(isUdpPortInUse(7777, '10.9.9.9')).resolves.toBe(false);
    });
  });

  describe('isTcpPortInUse', () => {
    let server: FakeServer;

    beforeEach(() => {
      server = new FakeServer();
      mockNet.createServer.mockReturnValue(server);
    });

    it('listens exclusively on the given address', async () => {
      server.listen.mockImplementation(() => server.emit('listening'));

      await isTcpPortInUse(27020, '10.0.0.5');

      expect(server.listen).toHaveBeenCalledWith({ port: 27020, host: '10.0.0.5', exclusive: true });
    });

    it('listens on every interface when no address is given', async () => {
      server.listen.mockImplementation(() => server.emit('listening'));

      await isTcpPortInUse(27020);

      expect(server.listen).toHaveBeenCalledWith({ port: 27020, host: '0.0.0.0', exclusive: true });
    });

    it('reports a free port and releases it', async () => {
      server.listen.mockImplementation(() => server.emit('listening'));

      await expect(isTcpPortInUse(27020)).resolves.toBe(false);
      expect(server.close).toHaveBeenCalled();
    });

    it.each(['EADDRINUSE', 'EACCES'])('reports a port it cannot listen on with %s as in use', async code => {
      server.listen.mockImplementation(() => server.emit('error', errno(code)));

      await expect(isTcpPortInUse(27020)).resolves.toBe(true);
    });

    it('does not block a start on an error that says nothing about the port', async () => {
      server.listen.mockImplementation(() => server.emit('error', errno('EADDRNOTAVAIL')));

      await expect(isTcpPortInUse(27020, '10.9.9.9')).resolves.toBe(false);
    });
  });
});
