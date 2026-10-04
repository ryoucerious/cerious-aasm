import { messagingService } from '../services/messaging.service';
import { webServerService } from '../services/web-server.service';
import { settingsService } from '../services/settings.service';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/web-server.service', () => ({
  webServerService: { startWebServer: jest.fn(), stopWebServer: jest.fn(), getStatus: jest.fn() }
}));
jest.mock('../services/settings.service', () => ({
  settingsService: { getGlobalConfig: jest.fn(), getWebServerAuthConfig: jest.fn() }
}));

const mockMessaging = jest.mocked(messagingService);
const mockWebServer = jest.mocked(webServerService);
const noLogin = { enabled: false, username: '', password: '' };

type Listener = (payload: unknown, sender: unknown) => Promise<void> | void;

describe('web-server-handler', () => {
  const sender = { send: jest.fn() };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./web-server-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  beforeEach(() => {
    jest.mocked(settingsService.getWebServerAuthConfig).mockReturnValue(noLogin);
    mockWebServer.getStatus.mockReturnValue({ running: false, port: 8080 });
  });

  function replies(channel: string) {
    return mockMessaging.sendToOriginator.mock.calls.filter(([replyChannel]) => replyChannel === channel).map(call => call[1]);
  }

  describe('start-web-server', () => {
    it('starts on the requested port with the configured login', async () => {
      mockWebServer.startWebServer.mockResolvedValue({ success: true, message: 'Server started', port: 8080 });

      await handlers['start-web-server']({ port: 8080, requestId: 'r1' }, sender);

      expect(mockWebServer.startWebServer).toHaveBeenCalledWith(8080, noLogin);
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('start-web-server', {
        success: true, port: 8080, message: 'Server started', requestId: 'r1'
      }, sender);
    });

    it.each([[{}], [undefined]])('defaults to port 3000 (payload %p)', async payload => {
      mockWebServer.startWebServer.mockResolvedValue({ success: true, message: 'Server started', port: 3000 });

      await handlers['start-web-server'](payload, sender);

      expect(mockWebServer.startWebServer).toHaveBeenCalledWith(3000, noLogin);
    });

    it('passes on a failed start', async () => {
      mockWebServer.startWebServer.mockResolvedValue({ success: false, message: 'listen EADDRINUSE', port: 8080 });

      await handlers['start-web-server']({ port: 8080 }, sender);

      expect(replies('start-web-server')).toEqual([{ success: false, port: 8080, message: 'listen EADDRINUSE', requestId: undefined }]);
    });

    it.each([80, 70000, 'abc', 3000.5])('refuses port %p without starting anything', async port => {
      await handlers['start-web-server']({ port, requestId: 'r1' }, sender);

      expect(mockWebServer.startWebServer).not.toHaveBeenCalled();
      expect(replies('start-web-server')).toEqual([{
        success: false, port, message: 'Failed to start web server: Invalid web server port', requestId: 'r1'
      }]);
    });

    it('replies with the reason when starting throws', async () => {
      mockWebServer.startWebServer.mockRejectedValue(new Error('Start failed'));

      await handlers['start-web-server']({ port: 8080 }, sender);

      expect(replies('start-web-server')).toEqual([{
        success: false, port: 8080, message: 'Failed to start web server: Start failed', requestId: undefined
      }]);
    });
  });

  describe('stop-web-server', () => {
    it('stops the server and reports the status to the caller', async () => {
      mockWebServer.stopWebServer.mockResolvedValue({ success: true, message: 'Web server stopped successfully' });

      await handlers['stop-web-server']({ requestId: 'r1' }, sender);

      expect(replies('stop-web-server')).toEqual([{ success: true, message: 'Web server stopped successfully', requestId: 'r1' }]);
      expect(replies('web-server-status')).toEqual([{ running: false, port: 8080, message: 'Web server stopped successfully' }]);
    });

    it('answers a request without a payload', async () => {
      mockWebServer.stopWebServer.mockResolvedValue({ success: true, message: 'Web server was not running' });

      await handlers['stop-web-server'](undefined, sender);

      expect(replies('stop-web-server')).toEqual([{ success: true, message: 'Web server was not running', requestId: undefined }]);
    });

    it('reports the current status when stopping throws', async () => {
      mockWebServer.stopWebServer.mockRejectedValue(new Error('Stop failed'));
      mockWebServer.getStatus.mockReturnValue({ running: true, port: 8080 });

      await handlers['stop-web-server']({}, sender);

      expect(replies('stop-web-server')).toEqual([{
        success: false, message: 'Error stopping web server: Stop failed', requestId: undefined
      }]);
      expect(replies('web-server-status')).toEqual([{
        running: true, port: 8080, message: 'Error stopping web server: Stop failed'
      }]);
    });
  });

  describe('web-server-status', () => {
    it('replies with the status and no requestId', () => {
      mockWebServer.getStatus.mockReturnValue({ running: true, port: 8080 });

      handlers['web-server-status']({ requestId: 'r1' }, sender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('web-server-status', { running: true, port: 8080 }, sender);
    });
  });
});
