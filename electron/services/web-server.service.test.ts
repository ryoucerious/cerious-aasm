import { WebServerService } from './web-server.service';
import * as globalConfigUtils from '../utils/global-config.utils';
import * as networkUtils from '../utils/network.utils';
import { messagingService } from './messaging.service';
import * as path from 'path';
import { app } from 'electron';

describe('WebServerService', () => {
  let service: WebServerService;

  beforeEach(() => {
    service = new WebServerService();
    jest.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));
    jest.spyOn(app, 'getAppPath').mockReturnValue('/app');
    jest.spyOn(globalConfigUtils, 'loadGlobalConfig').mockReturnValue({
      authenticationEnabled: true,
      authenticationUsername: 'user',
      authenticationPassword: 'pass',
      webServerPort: 3000,
      startWebServerOnLoad: true,
      maxBackupDownloadSizeMB: 100
    });
    jest.spyOn(networkUtils, 'isPortInUse').mockResolvedValue(false);
    jest.spyOn(messagingService, 'broadcastToWebClients').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('getStatus returns running and port', () => {
    expect(service.getStatus()).toEqual({ running: false, port: 3000 });
  });

  it('isStarting returns false by default', () => {
    expect(service.isStarting()).toBe(false);
  });

  it('cleanup resets state and kills process', () => {
    const killMock = jest.fn();
    (service as any).apiProcess = { kill: killMock };
    (service as any).statusPollingInterval = setInterval(() => {}, 1000);
    service.cleanup();
    expect(killMock).toHaveBeenCalled();
    expect((service as any).apiProcess).toBeNull();
    expect((service as any).statusPollingInterval).toBeNull();
    expect(service.getStatus().running).toBe(false);
  });

  it('startWebServer returns already starting if webServerStarting', async () => {
    (service as any).webServerStarting = true;
    const result = await service.startWebServer(3000);
    expect(result.success).toBe(true);
    expect(result.message).toContain('already starting');
  });

  it('startWebServer returns already running if apiProcess exists and running', async () => {
    (service as any).apiProcess = { on: jest.fn(), kill: jest.fn() };
    (service as any).webServerRunning = true;
    (service as any).webServerPort = 3000;
    const result = await service.startWebServer(3000);
    expect(result.success).toBe(true);
    expect(result.message).toContain('already running');
  });

  it('stopWebServer returns success if not running', async () => {
    (service as any).apiProcess = null;
    const result = await service.stopWebServer();
    expect(result.success).toBe(true);
    expect(result.message).toContain('not running');
  });

  it('stopWebServer kills process and resolves', async () => {
  const onMock = jest.fn((event, cb) => { if (event === 'exit') cb(); });
  let exitCallback: (() => void) | undefined;
  const onMockExit = jest.fn((event, cb) => { if (event === 'exit') exitCallback = cb; });
  const killMock = jest.fn(() => { if (exitCallback) exitCallback(); });
  (service as any).apiProcess = { on: onMockExit, kill: killMock };
  const result = await service.stopWebServer();
  expect(killMock).toHaveBeenCalled();
  expect(result.success).toBe(true);
  expect(result.message).toContain('stopped successfully');
  });
});
