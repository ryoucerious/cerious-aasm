import * as net from 'net';
import type { Server } from 'http';
import express from 'express';
import helmet from 'helmet';
import { createApp, getServerPort, startServer } from './server-setup';
import { messagingService } from '../services/messaging.service';
import { sessionAuth } from './auth-middleware';
import { setupAuthRoutes } from './auth-routes';
import { setupIPCHandlers } from './ipc-handlers';
import { installSocketAuth } from './socket-auth';

jest.mock('express', () => {
  const app = { use: jest.fn(), get: jest.fn(), post: jest.fn(), listen: jest.fn(), set: jest.fn() };
  const factory = Object.assign(jest.fn(() => app), {
    json: jest.fn(() => 'json-middleware'),
    static: jest.fn(() => 'static-middleware')
  });
  return { __esModule: true, default: factory };
});
jest.mock('helmet', () => ({ __esModule: true, default: jest.fn(() => 'helmet-middleware') }));
jest.mock('../services/messaging.service', () => ({ messagingService: { attachWebSocketServer: jest.fn() } }));
jest.mock('./auth-middleware', () => ({ sessionAuth: jest.fn() }));
jest.mock('./auth-routes', () => ({ setupAuthRoutes: jest.fn() }));
jest.mock('./ipc-handlers', () => ({ setupIPCHandlers: jest.fn() }));
jest.mock('./socket-auth', () => ({ installSocketAuth: jest.fn() }));

const mockedExpress = jest.mocked(express);

describe('server-setup', () => {
  describe('createApp', () => {
    let app: { use: jest.Mock; get: jest.Mock; post: jest.Mock };

    beforeEach(() => {
      app = createApp() as unknown as typeof app;
    });

    describe('behind a reverse proxy', () => {
      afterEach(() => { delete process.env.AASM_TRUST_PROXY; });

      function trusted(value?: string): unknown {
        if (value === undefined) delete process.env.AASM_TRUST_PROXY;
        else process.env.AASM_TRUST_PROXY = value;
        const made = createApp() as unknown as { set: jest.Mock };
        const call = made.set.mock.calls.find(([name]) => name === 'trust proxy');
        made.set.mockClear();
        return call ? call[1] : 'not set';
      }

      it('ignores X-Forwarded headers unless a proxy is named, since any client could send them', () => {
        expect(trusted()).toBe('not set');
        expect(trusted('  ')).toBe('not set');
      });

      it('believes them from the proxies named', () => {
        expect(trusted('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
      });

      it('reads a number as the count of proxies in front', () => {
        expect(trusted('1')).toBe(1);
      });

      it('reads true as trusting whatever connects', () => {
        expect(trusted('true')).toBe(true);
      });
    });

    it('sets the security headers that work over plain HTTP on a LAN', () => {
      expect(helmet).toHaveBeenCalledWith({ contentSecurityPolicy: false, hsts: false, crossOriginEmbedderPolicy: false });
      expect(app.use.mock.calls[0]).toEqual(['helmet-middleware']);
    });

    it('serves the UI before the session check, so the login page can load', () => {
      const uses = app.use.mock.calls.map(call => call[0]);

      expect(mockedExpress.static).toHaveBeenCalledWith(expect.stringMatching(/dist\/cerious-aasm\/browser$/));
      expect(uses.indexOf('static-middleware')).toBeLessThan(uses.indexOf('/api'));
      expect(app.use).toHaveBeenCalledWith('/api', sessionAuth);
      expect(setupAuthRoutes).toHaveBeenCalledWith(app);
    });

    it('allows no cross-origin requests and has no message route', () => {
      const routes = [...app.get.mock.calls, ...app.post.mock.calls].map(call => call[0]);

      expect(routes).not.toContain('/api/message');
      expect(routes).not.toContain('/api/hello');
      expect(app.use).toHaveBeenCalledTimes(5);
    });

    it('answers every other path with the UI', () => {
      const fallback = app.use.mock.calls[app.use.mock.calls.length - 1][0];
      const res = { sendFile: jest.fn() };

      fallback({}, res);

      expect(res.sendFile).toHaveBeenCalledWith(expect.stringMatching(/dist\/cerious-aasm\/browser\/index\.html$/));
    });
  });

  describe('getServerPort', () => {
    const argv = process.argv;
    const env = process.env;

    beforeEach(() => {
      process.env = { ...env };
      delete process.env.PORT;
    });

    afterEach(() => {
      process.argv = argv;
      process.env = env;
    });

    it('reads --port', () => {
      process.argv = ['node', 'server.js', '--port=8080'];
      process.env.PORT = '9090';

      expect(getServerPort()).toBe(8080);
    });

    it('falls back to PORT, then 3000', () => {
      process.argv = ['node', 'server.js'];
      expect(getServerPort()).toBe(3000);

      process.env.PORT = '9090';
      expect(getServerPort()).toBe(9090);
    });

    it.each(['--port=invalid', '--port=0', '--port=70000', '--port=80abc'])('ignores %s', arg => {
      process.argv = ['node', 'server.js', arg];

      expect(getServerPort()).toBe(3000);
    });
  });

  describe('startServer', () => {
    // Jest's own worker may be talking to its parent over process.send, so it is put back after.
    const originalSend = process.send;
    const realExpress = jest.requireActual<typeof import('express')>('express');
    let send: jest.Mock;
    let servers: Array<net.Server | Server>;

    beforeEach(() => {
      send = jest.fn();
      process.send = send;
      servers = [];
    });

    afterEach(async () => {
      process.send = originalSend;
      await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    });

    function start(port: number): Server {
      startServer(realExpress(), port);
      const server = jest.mocked(messagingService.attachWebSocketServer).mock.calls[0][0];
      servers.push(server);
      return server;
    }

    function nextMessage(): Promise<unknown> {
      return new Promise(resolve => send.mockImplementationOnce(message => resolve(message)));
    }

    it('reports ready once it is listening', async () => {
      const message = nextMessage();
      start(0);

      expect(await message).toEqual({ type: 'server-ready', port: 0, message: 'Server started on port 0' });
      expect(setupIPCHandlers).toHaveBeenCalled();
      expect(installSocketAuth).toHaveBeenCalled();
    });

    it('reports failure, not ready, when the port is taken', async () => {
      const blocker = net.createServer();
      servers.push(blocker);
      await new Promise<void>(resolve => blocker.listen(0, resolve));
      const port = (blocker.address() as net.AddressInfo).port;

      const message = nextMessage();
      start(port);

      expect(await message).toEqual({ type: 'server-error', port, error: expect.stringContaining('EADDRINUSE') });
      await new Promise(resolve => setImmediate(resolve));
      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});
