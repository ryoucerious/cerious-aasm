// Mock the services
jest.mock('../services/messaging.service');
jest.mock('../services/web-server.service', () => ({
  webServerService: {
    startWebServer: jest.fn(),
    stopWebServer: jest.fn(),
    getStatus: jest.fn(),
    cleanup: jest.fn()
  }
}));
jest.mock('../services/settings.service', () => ({
  settingsService: {
    getGlobalConfig: jest.fn(),
    getWebServerAuthConfig: jest.fn()
  }
}));

import { messagingService } from '../services/messaging.service';
import { webServerService } from '../services/web-server.service';
import { settingsService } from '../services/settings.service';

const mockMessagingService = messagingService as jest.Mocked<typeof messagingService>;
const mockWebServerService = webServerService as jest.Mocked<typeof webServerService>;

// Store handler functions for testing
let startWebServerHandler: Function;
let stopWebServerHandler: Function;
let webServerStatusHandler: Function;

describe('Web Server Handler', () => {
  let mockSender: any;

  beforeAll(() => {
    // Import handler to register events
    require('./web-server-handler');

    // Capture the registered event handlers
    const mockOn = mockMessagingService.on as jest.Mock;
    mockOn.mock.calls.forEach(([event, handler]) => {
      if (event === 'start-web-server') {
        startWebServerHandler = handler;
      } else if (event === 'stop-web-server') {
        stopWebServerHandler = handler;
      } else if (event === 'web-server-status') {
        webServerStatusHandler = handler;
      }
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSender = {
      send: jest.fn()
    };

    // Set up default mock responses
    (settingsService.getGlobalConfig as jest.Mock).mockReturnValue({
      authenticationEnabled: false,
      authenticationUsername: '',
      authenticationPassword: ''
    });
    (settingsService.getWebServerAuthConfig as jest.Mock).mockReturnValue({
      enabled: false,
      username: '',
      password: ''
    });
  });

  afterEach(() => {
    // Clean up any intervals started by the service
    mockWebServerService.cleanup();
  });

  describe('start-web-server event', () => {
    it('should start web server successfully with port only', async () => {
      const payload = { port: 8080 };
      const expectedResult = { success: true, message: 'Server started', port: 8080 };

      mockWebServerService.startWebServer.mockResolvedValue(expectedResult);

      await startWebServerHandler(payload, mockSender);

      expect(mockWebServerService.startWebServer).toHaveBeenCalledWith(8080, {
        enabled: false,
        username: '',
        password: ''
      });
      expect(mockSender.send).toHaveBeenCalledWith('start-web-server', {
        success: true,
        port: 8080,
        message: 'Server started',
        requestId: undefined
      });
    });

    it('should start web server successfully with default port when no port provided', async () => {
      const payload = {};
      const expectedResult = { success: true, message: 'Server started', port: 3000 };

      mockWebServerService.startWebServer.mockResolvedValue(expectedResult);

      await startWebServerHandler(payload, mockSender);

      expect(mockWebServerService.startWebServer).toHaveBeenCalledWith(3000, {
        enabled: false,
        username: '',
        password: ''
      });
      expect(mockSender.send).toHaveBeenCalledWith('start-web-server', {
        success: true,
        port: 3000,
        message: 'Server started',
        requestId: undefined
      });
    });

    it('should start web server successfully with requestId', async () => {
      const payload = { port: 8080, requestId: 'test-123' };
      const expectedResult = { success: true, message: 'Server started', port: 8080 };

      mockWebServerService.startWebServer.mockResolvedValue(expectedResult);

      await startWebServerHandler(payload, mockSender);

      expect(mockWebServerService.startWebServer).toHaveBeenCalledWith(8080, {
        enabled: false,
        username: '',
        password: ''
      });
      expect(mockSender.send).toHaveBeenCalledWith('start-web-server', {
        success: true,
        port: 8080,
        message: 'Server started',
        requestId: 'test-123'
      });
    });

    it('should handle web server start failure', async () => {
      const payload = { port: 8080 };
      const expectedResult = { success: false, message: 'Failed to start server', port: 8080 };

      mockWebServerService.startWebServer.mockResolvedValue(expectedResult);

      await startWebServerHandler(payload, mockSender);

      expect(mockWebServerService.startWebServer).toHaveBeenCalledWith(8080, {
        enabled: false,
        username: '',
        password: ''
      });
      expect(mockSender.send).toHaveBeenCalledWith('start-web-server', {
        success: false,
        port: 8080,
        message: 'Failed to start server',
        requestId: undefined
      });
    });

    it('should handle start web server exception', async () => {
      const payload = { port: 8080 };
      const error = new Error('Start failed');

      mockWebServerService.startWebServer.mockRejectedValue(error);

      await startWebServerHandler(payload, mockSender);

      expect(mockWebServerService.startWebServer).toHaveBeenCalledWith(8080, {
        enabled: false,
        username: '',
        password: ''
      });
      expect(mockSender.send).toHaveBeenCalledWith('start-web-server', {
        success: false,
        port: 8080,
        message: 'Failed to start web server: Error: Start failed',
        requestId: undefined
      });
    });
  });

  describe('stop-web-server event', () => {
    beforeEach(() => {
      mockWebServerService.getStatus.mockReturnValue({ running: false, port: 8080 });
    });

    it('should stop web server successfully', async () => {
      const payload = {};
      const expectedResult = { success: true, message: 'Web server stopped successfully' };

      mockWebServerService.stopWebServer.mockResolvedValue(expectedResult);

      await stopWebServerHandler(payload, mockSender);

      expect(mockWebServerService.stopWebServer).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('stop-web-server', {
        success: true,
        message: 'Web server stopped successfully',
        requestId: undefined
      });
      expect(mockSender.send).toHaveBeenCalledWith('web-server-status', {
        running: false,
        port: 8080,
        message: 'Web server stopped successfully'
      });
    });

    it('should stop web server successfully with requestId', async () => {
      const payload = { requestId: 'test-123' };
      const expectedResult = { success: true, message: 'Web server stopped successfully' };

      mockWebServerService.stopWebServer.mockResolvedValue(expectedResult);

      await stopWebServerHandler(payload, mockSender);

      expect(mockWebServerService.stopWebServer).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('stop-web-server', {
        success: true,
        message: 'Web server stopped successfully',
        requestId: 'test-123'
      });
      expect(mockSender.send).toHaveBeenCalledWith('web-server-status', {
        running: false,
        port: 8080,
        message: 'Web server stopped successfully'
      });
    });

    it('should handle web server stop failure', async () => {
      const payload = {};
      const expectedResult = { success: false, message: 'Failed to stop web server' };

      mockWebServerService.stopWebServer.mockResolvedValue(expectedResult);

      await stopWebServerHandler(payload, mockSender);

      expect(mockWebServerService.stopWebServer).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('stop-web-server', {
        success: false,
        message: 'Failed to stop web server',
        requestId: undefined
      });
      expect(mockSender.send).toHaveBeenCalledWith('web-server-status', {
        running: false,
        port: 8080,
        message: 'Failed to stop web server'
      });
    });

    it('should handle stop web server exception', async () => {
      const payload = {};
      const error = new Error('Stop failed');

      mockWebServerService.stopWebServer.mockRejectedValue(error);

      await stopWebServerHandler(payload, mockSender);

      expect(mockWebServerService.stopWebServer).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('stop-web-server', {
        success: false,
        message: 'Error stopping web server: Error: Stop failed',
        requestId: undefined
      });
      expect(mockSender.send).toHaveBeenCalledWith('web-server-status', {
        running: false,
        port: 8080,
        message: 'Error stopping web server: Error: Stop failed'
      });
    });
  });

  describe('web-server-status event', () => {
    it('should return web server status when running', () => {
      const expectedStatus = { running: true, port: 8080 };

      mockWebServerService.getStatus.mockReturnValue(expectedStatus);

      webServerStatusHandler({}, mockSender);

      expect(mockWebServerService.getStatus).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('web-server-status', expectedStatus);
    });

    it('should return web server status when not running', () => {
      const expectedStatus = { running: false, port: 0 };

      mockWebServerService.getStatus.mockReturnValue(expectedStatus);

      webServerStatusHandler({}, mockSender);

      expect(mockWebServerService.getStatus).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('web-server-status', expectedStatus);
    });
  });
});