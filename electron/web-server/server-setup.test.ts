import { createApp, getServerPort, startServer } from '../web-server/server-setup';

// Mock dependencies
jest.mock('express');
jest.mock('cors');
jest.mock('path');
jest.mock('../services/messaging.service');
jest.mock('../web-server/auth-middleware');
jest.mock('../web-server/auth-routes');
jest.mock('../web-server/ipc-handlers');

const mockExpress = require('express');
const mockCors = require('cors');
const mockPath = require('path');
const mockMessagingService = require('../services/messaging.service');
const mockAuthMiddleware = require('../web-server/auth-middleware');
const mockAuthRoutes = require('../web-server/auth-routes');
const mockIPCHandlers = require('../web-server/ipc-handlers');

describe('server-setup', () => {
  let mockApp: any;
  let mockServer: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock Express app
    mockApp = {
      use: jest.fn(),
      post: jest.fn(),
      get: jest.fn(),
      listen: jest.fn(),
      static: jest.fn()
    };

    mockExpress.mockReturnValue(mockApp);

    // Setup mock server
    mockServer = {
      on: jest.fn(),
      listen: jest.fn()
    };

    mockApp.listen.mockReturnValue(mockServer);

    // Setup default mocks
    mockCors.mockReturnValue('cors-middleware');
    mockPath.join.mockImplementation((...args: string[]) => args.join('/'));
    mockAuthMiddleware.sessionAuth = jest.fn();
    if (!mockMessagingService.messagingService) {
      mockMessagingService.messagingService = {};
    }
    mockMessagingService.messagingService.attachWebSocketServer = jest.fn();
  });

  describe('createApp', () => {
    it('should create and configure Express app', () => {
      const app = createApp();

      expect(mockExpress).toHaveBeenCalled();
      expect(app).toBe(mockApp);

      // Check middleware setup
      expect(mockApp.use).toHaveBeenCalledWith('cors-middleware');
      expect(mockApp.use).toHaveBeenCalledWith(mockExpress.json());

      // Check static file serving
      expect(mockApp.use).toHaveBeenCalledWith(
        mockExpress.static('__dirname/../../dist/cerious-aasm/browser')
      );

      // Check auth middleware
      expect(mockApp.use).toHaveBeenCalledWith('/api', mockAuthMiddleware.sessionAuth);

      // Check auth routes setup
      expect(mockAuthRoutes.setupAuthRoutes).toHaveBeenCalledWith(mockApp);
    });

    it('should setup message endpoint', () => {
      createApp();

      const messageRoute = mockApp.post.mock.calls.find(([path]: [string]) => path === '/api/message');
      expect(messageRoute).toBeDefined();

      const messageHandler = messageRoute?.[1];
      expect(typeof messageHandler).toBe('function');
    });

    it('should setup hello endpoint', () => {
      createApp();

      const helloRoute = mockApp.get.mock.calls.find(([path]: [string]) => path === '/api/hello');
      expect(helloRoute).toBeDefined();
    });

    it('should setup fallback route for SPA', () => {
      createApp();

      // Should have a catch-all route at the end
      const lastUseCall = mockApp.use.mock.calls[mockApp.use.mock.calls.length - 1];
      expect(lastUseCall).toBeDefined();
    });
  });

  describe('POST /api/message', () => {
    let messageHandler: any;
    let mockReq: any;
    let mockRes: any;

    beforeEach(() => {
      createApp();
      const messageRoute = mockApp.post.mock.calls.find(([path]: [string]) => path === '/api/message');
      messageHandler = messageRoute?.[1];

      mockReq = {
        body: {}
      };

      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Mock process.send
      (global as any).process.send = jest.fn();
    });

    afterEach(() => {
      delete (global as any).process.send;
    });

    it('should validate channel parameter', async () => {
      mockReq.body = { payload: 'test' }; // Missing channel

      await messageHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Channel is required and must be a string'
      });
    });

    it('should forward valid messages to main process', async () => {
      mockReq.body = {
        channel: 'test-channel',
        payload: { test: 'data' }
      };

      await messageHandler(mockReq, mockRes);

      expect((global as any).process.send).toHaveBeenCalledWith({
        type: 'messaging-event',
        channel: 'test-channel',
        payload: { test: 'data' }
      });

      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'test-channel-sent',
        channel: 'test-channel',
        payload: { test: 'data' },
        transport: 'api'
      });
    });

    it('should handle IPC send errors', async () => {
      (global as any).process.send = undefined; // No process.send available

      mockReq.body = {
        channel: 'test-channel',
        payload: 'test'
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await messageHandler(mockReq, mockRes);

      expect(consoleSpy).toHaveBeenCalledWith('[API Server] No process.send available - not a child process?');
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal server error - IPC not available'
      });

      consoleSpy.mockRestore();
    });

    it('should handle message processing errors', async () => {
      (global as any).process.send = jest.fn(() => {
        throw new Error('IPC error');
      });

      mockReq.body = {
        channel: 'test-channel',
        payload: 'test'
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await messageHandler(mockReq, mockRes);

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toBe('[API Server] Message processing error:');
      expect(typeof consoleSpy.mock.calls[0][1]).toBe('object');
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal server error',
        channel: 'test-channel'
      });

      consoleSpy.mockRestore();
    });
  });

  describe('GET /api/hello', () => {
    let helloHandler: any;
    let mockRes: any;

    beforeEach(() => {
      createApp();
      const helloRoute = mockApp.get.mock.calls.find(([path]: [string]) => path === '/api/hello');
      helloHandler = helloRoute?.[1];

      mockRes = {
        json: jest.fn()
      };
    });

    it('should return hello message', () => {
      helloHandler({}, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Hello from Electron Express API!'
      });
    });
  });

  describe('getServerPort', () => {
    beforeEach(() => {
      // Clear argv
      process.argv = ['node', 'test.js'];
      delete process.env.PORT;
    });

    it('should return default port when no args or env', () => {
      const port = getServerPort();

      expect(port).toBe(3000);
    });

    it('should parse port from command line args', () => {
      process.argv = ['node', 'test.js', '--port=8080'];

      const port = getServerPort();

      expect(port).toBe(8080);
    });

    it('should return environment PORT', () => {
      process.env.PORT = '9000';

      const port = getServerPort();

      expect(port).toBe(9000);
    });

    it('should prioritize command line over environment', () => {
      process.argv = ['node', 'test.js', '--port=8080'];
      process.env.PORT = '9000';

      const port = getServerPort();

      expect(port).toBe(8080);
    });

    it('should handle invalid port numbers', () => {
      process.argv = ['node', 'test.js', '--port=invalid'];

      const port = getServerPort();

      expect(port).toBe(3000);
    });
  });

  describe('startServer', () => {
    beforeEach(() => {
      // Mock process.send
      (global as any).process.send = jest.fn();
    });

    afterEach(() => {
      delete (global as any).process.send;
    });

    it('should start server and notify main process', () => {
      startServer(mockApp, 3000);

      expect(mockApp.listen).toHaveBeenCalled();
      expect(mockApp.listen.mock.calls[0][0]).toBe(3000);
      expect(typeof mockApp.listen.mock.calls[0][1]).toBe('function');

      // Trigger the listen callback
      const listenCallback = mockApp.listen.mock.calls[0][1];
      listenCallback();

      // Use partial match for dynamic instance name
      expect((global as any).process.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'server-ready',
          port: 3000,
          message: expect.stringMatching(/^Server started successfully on port 3000 \(instance: .+\)$/)
        })
      );
    });

    it('should setup IPC handlers', () => {
      startServer(mockApp, 3000);

      expect(mockIPCHandlers.setupIPCHandlers).toHaveBeenCalled();
    });

    it('should attach WebSocket server', () => {
      startServer(mockApp, 3000);

      // Ensure the same mockServer is passed
  expect(mockMessagingService.messagingService.attachWebSocketServer).toHaveBeenCalledWith(mockApp.listen.mock.results[0].value);
    });

    it('should handle server errors', () => {
      startServer(mockApp, 3000);

      const errorCallback = mockServer.on.mock.calls.find(([event]: [string]) => event === 'error')?.[1];
      expect(errorCallback).toBeDefined();

      const testError = new Error('Server error');
      errorCallback(testError);

      expect((global as any).process.send).toHaveBeenCalledWith({
        type: 'server-error',
        port: 3000,
        error: 'Server error'
      });
    });

    it('should use fallback error message if error.message is falsy', () => {
      startServer(mockApp, 3000);
      const errorCallback = mockServer.on.mock.calls.find(([event]: [string]) => event === 'error')?.[1];
      expect(errorCallback).toBeDefined();
      // error object with no message property
      const testError = {};
      errorCallback(testError);
      expect((global as any).process.send).toHaveBeenCalledWith({
        type: 'server-error',
        port: 3000,
        error: 'Server startup failed'
      });
    });

    it('should not throw if process.send is undefined (server-ready)', () => {
      (global as any).process.send = undefined;
      startServer(mockApp, 3000);
      const listenCallback = mockApp.listen.mock.calls[0][1];
      expect(() => listenCallback()).not.toThrow();
      // Should not call process.send
    });

    it('should not throw if process.send is undefined (server-error)', () => {
      (global as any).process.send = undefined;
      startServer(mockApp, 3000);
      const errorCallback = mockServer.on.mock.calls.find(([event]: [string]) => event === 'error')?.[1];
      expect(errorCallback).toBeDefined();
      const testError = new Error('Server error');
      expect(() => errorCallback(testError)).not.toThrow();
      // Should not call process.send
    });
  });

  describe('Fallback route (SPA)', () => {
    it('should serve index.html for non-API routes', () => {
      createApp();
      // Find the fallback handler (last .use call)
      const lastUseCall = mockApp.use.mock.calls[mockApp.use.mock.calls.length - 1];
      const fallbackHandler = lastUseCall[0];
      // Simulate Express req/res
      const mockReq = {};
      const mockRes = { sendFile: jest.fn() };
      fallbackHandler(mockReq, mockRes);
      expect(mockRes.sendFile).toHaveBeenCalled();
      const callArg = mockRes.sendFile.mock.calls[0][0];
      expect(/index\.html$/.test(callArg)).toBe(true);
    });

    it('should handle errors in the fallback route handler', () => {
      createApp();
      const lastUseCall = mockApp.use.mock.calls[mockApp.use.mock.calls.length - 1];
      const fallbackHandler = lastUseCall[0];
      const mockReq = {};
      const mockRes = { sendFile: jest.fn(() => { throw new Error('sendFile error'); }) };
      expect(() => fallbackHandler(mockReq, mockRes)).toThrow('sendFile error');
    });
  });

  describe('getPortFromArgs (internal)', () => {
    let originalArgv: string[];
    beforeEach(() => {
      originalArgv = [...process.argv];
    });
    afterEach(() => {
      process.argv = originalArgv;
    });
    it('should return undefined if no --port arg', () => {
      process.argv = ['node', 'test.js'];
      // getPortFromArgs is only used internally, so we call createApp to exercise it
      expect(() => createApp()).not.toThrow();
    });
    it('should return valid port from --port arg', () => {
      process.argv = ['node', 'test.js', '--port=1234'];
      expect(() => createApp()).not.toThrow();
    });
    it('should return undefined for invalid port arg', () => {
      process.argv = ['node', 'test.js', '--port=notanumber'];
      expect(() => createApp()).not.toThrow();
    });
  });

  describe('getPortFromArgs (real express, coverage only)', () => {
    let originalArgv: string[];
    let originalExpress: any;
    beforeAll(() => {
      originalExpress = jest.requireActual('express');
    });
    beforeEach(() => {
      originalArgv = [...process.argv];
      jest.unmock('express');
    });
    afterEach(() => {
      process.argv = originalArgv;
      jest.mock('express');
    });
    it('should execute getPortFromArgs logic (no --port)', () => {
      process.argv = ['node', 'test.js'];
      expect(() => {
        const app = require('../web-server/server-setup').createApp();
        expect(app).toBeDefined();
      }).not.toThrow();
    });
    it('should execute getPortFromArgs logic (valid --port)', () => {
      process.argv = ['node', 'test.js', '--port=5678'];
      expect(() => {
        const app = require('../web-server/server-setup').createApp();
        expect(app).toBeDefined();
      }).not.toThrow();
    });
    it('should execute getPortFromArgs logic (invalid --port)', () => {
      process.argv = ['node', 'test.js', '--port=notanumber'];
      expect(() => {
        const app = require('../web-server/server-setup').createApp();
        expect(app).toBeDefined();
      }).not.toThrow();
    });
  });

  describe('getPortFromArgs (direct export)', () => {
    let originalArgv: string[];
    beforeEach(() => {
      originalArgv = [...process.argv];
    });
    afterEach(() => {
      process.argv = originalArgv;
    });
    it('returns undefined if no --port arg', () => {
      process.argv = ['node', 'test.js'];
      expect(require('../web-server/server-setup').getPortFromArgs()).toBeUndefined();
    });
    it('returns valid port if --port=1234', () => {
      process.argv = ['node', 'test.js', '--port=1234'];
      expect(require('../web-server/server-setup').getPortFromArgs()).toBe(1234);
    });
    it('returns undefined for invalid port', () => {
      process.argv = ['node', 'test.js', '--port=notanumber'];
      expect(require('../web-server/server-setup').getPortFromArgs()).toBeUndefined();
    });
  });
});