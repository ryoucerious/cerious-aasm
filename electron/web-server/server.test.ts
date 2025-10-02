import { startWebServer } from '../web-server/server';

// Mock dependencies
jest.mock('../web-server/auth-config');
jest.mock('../web-server/server-setup');

const mockAuthConfig = require('../web-server/auth-config');
const mockServerSetup = require('../web-server/server-setup');

describe('server', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup console.error spy
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Setup process.exit spy
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation();

    // Setup default mocks
    mockAuthConfig.initializeAuth = jest.fn().mockResolvedValue(undefined);
    mockServerSetup.createApp = jest.fn().mockReturnValue('mock-app');
    mockServerSetup.getServerPort = jest.fn().mockReturnValue(3000);
    mockServerSetup.startServer = jest.fn();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('startWebServer', () => {
    it('should initialize auth, create app, and start server successfully', async () => {
      await startWebServer();

      expect(mockAuthConfig.initializeAuth).toHaveBeenCalled();
      expect(mockServerSetup.createApp).toHaveBeenCalled();
      expect(mockServerSetup.getServerPort).toHaveBeenCalled();
      expect(mockServerSetup.startServer).toHaveBeenCalledWith('mock-app', 3000);

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should handle auth initialization errors', async () => {
      const testError = new Error('Auth init failed');
      mockAuthConfig.initializeAuth.mockRejectedValue(testError);

      await startWebServer();

      expect(mockAuthConfig.initializeAuth).toHaveBeenCalled();
      expect(mockServerSetup.createApp).not.toHaveBeenCalled();
      expect(mockServerSetup.getServerPort).not.toHaveBeenCalled();
      expect(mockServerSetup.startServer).not.toHaveBeenCalled();

      expect(consoleErrorSpy).toHaveBeenCalledWith('[Web Server] Failed to start:', testError);
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle app creation errors', async () => {
      const testError = new Error('App creation failed');
      mockServerSetup.createApp.mockImplementation(() => {
        throw testError;
      });

      await startWebServer();

      expect(mockAuthConfig.initializeAuth).toHaveBeenCalled();
      expect(mockServerSetup.createApp).toHaveBeenCalled();
      expect(mockServerSetup.getServerPort).not.toHaveBeenCalled();
      expect(mockServerSetup.startServer).not.toHaveBeenCalled();

      expect(consoleErrorSpy).toHaveBeenCalledWith('[Web Server] Failed to start:', testError);
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle port retrieval errors', async () => {
      const testError = new Error('Port retrieval failed');
      mockServerSetup.getServerPort.mockImplementation(() => {
        throw testError;
      });

      await startWebServer();

      expect(mockAuthConfig.initializeAuth).toHaveBeenCalled();
      expect(mockServerSetup.createApp).toHaveBeenCalled();
      expect(mockServerSetup.getServerPort).toHaveBeenCalled();
      expect(mockServerSetup.startServer).not.toHaveBeenCalled();

      expect(consoleErrorSpy).toHaveBeenCalledWith('[Web Server] Failed to start:', testError);
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle server startup errors', async () => {
      const testError = new Error('Server startup failed');
      mockServerSetup.startServer.mockImplementation(() => {
        throw testError;
      });

      await startWebServer();

      expect(mockAuthConfig.initializeAuth).toHaveBeenCalled();
      expect(mockServerSetup.createApp).toHaveBeenCalled();
      expect(mockServerSetup.getServerPort).toHaveBeenCalled();
      expect(mockServerSetup.startServer).toHaveBeenCalledWith('mock-app', 3000);

      expect(consoleErrorSpy).toHaveBeenCalledWith('[Web Server] Failed to start:', testError);
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('module execution', () => {
    it('should export startWebServer function', () => {
      expect(typeof startWebServer).toBe('function');
    });
  });

  describe('exports', () => {
    it('should export auth functions', () => {
      const serverModule = require('../web-server/server');

      expect(serverModule.updateAuthConfig).toBe(mockAuthConfig.updateAuthConfig);
      expect(serverModule.hashPassword).toBe(mockAuthConfig.hashPassword);
    });
  });
});