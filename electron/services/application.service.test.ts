import { ApplicationService } from './application.service';
import * as globalConfigUtils from '../utils/global-config.utils';
import * as webServerServiceModule from './web-server.service';

describe('ApplicationService', () => {
  let originalArgv: string[];
  let mockStartWebServer: jest.SpyInstance;
  let mockLoadGlobalConfig: jest.SpyInstance;

  beforeEach(() => {
    originalArgv = [...process.argv];
    mockStartWebServer = jest.spyOn(webServerServiceModule.webServerService, 'startWebServer').mockResolvedValue({ success: true, message: 'started', port: 1234 });
    mockLoadGlobalConfig = jest.spyOn(globalConfigUtils, 'loadGlobalConfig').mockReturnValue({
      startWebServerOnLoad: true,
      webServerPort: 1234,
      authenticationEnabled: false,
      authenticationUsername: '',
      authenticationPassword: '',
      maxBackupDownloadSizeMB: 100
    });
  });

  afterEach(() => {
    process.argv = originalArgv;
    jest.restoreAllMocks();
  });

  it('parses command line args with defaults', () => {
    process.argv = ['node', 'main.js'];
    const service = new ApplicationService();
    expect(service.getCommandLineArgs()).toEqual({
      isHeadless: false,
      authEnabled: false,
      username: 'admin',
      password: '',
      port: 1234
    });
  });

  it('parses command line args with headless and port', () => {
    process.argv = ['node', 'main.js', '--headless', '--port=8080'];
    const service = new ApplicationService();
    expect(service.getCommandLineArgs()).toMatchObject({
      isHeadless: true,
      port: 8080
    });
  });

  it('parses command line args with auth', () => {
    process.argv = ['node', 'main.js', '--headless', '--auth-enabled', '--username=test', '--password=secret'];
    const service = new ApplicationService();
    expect(service.getCommandLineArgs()).toMatchObject({
      authEnabled: true,
      username: 'test',
      password: 'secret'
    });
  });

  it('returns isHeadless()', () => {
    process.argv = ['node', 'main.js', '--headless'];
    const service = new ApplicationService();
    expect(service.isHeadless()).toBe(true);
  });

  it('initializes application in headless mode with auth', async () => {
    process.argv = ['node', 'main.js', '--headless', '--auth-enabled', '--password=secret'];
    const service = new ApplicationService();
    await service.initializeApplication();
    expect(mockStartWebServer).toHaveBeenCalledWith(expect.any(Number), {
      enabled: true,
      username: 'admin',
      password: 'secret'
    });
  });

  it('initializes application in headless mode without auth', async () => {
    process.argv = ['node', 'main.js', '--headless'];
    const service = new ApplicationService();
    await service.initializeApplication();
    expect(mockStartWebServer).toHaveBeenCalledWith(expect.any(Number), {
      enabled: false,
      username: '',
      password: ''
    });
  });

  it('initializes application in GUI mode and starts web server if configured', async () => {
    process.argv = ['node', 'main.js'];
    const service = new ApplicationService();
    await service.initializeApplication();
    expect(mockStartWebServer).toHaveBeenCalledWith(1234);
  });

  it('exits with error if --auth-enabled is set without --password', () => {
    process.argv = ['node', 'main.js', '--headless', '--auth-enabled'];
      let exited = false;
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { exited = true; return undefined as never; });
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const service = new ApplicationService();
      service.initializeApplication();
      expect(exited).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('requires --password'));
      exitSpy.mockRestore();
      errorSpy.mockRestore();
  });
});
