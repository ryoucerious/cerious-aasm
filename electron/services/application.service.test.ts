// The singleton is built on import; unmocked, the global config would be read through the fs
// mock, whose undefined read looks like a corrupt file.
jest.mock('../utils/global-config.utils', () => ({
  ...jest.requireActual('../utils/global-config.utils'),
  loadGlobalConfig: jest.fn(() => ({})),
}));

import { ApplicationService, readAuthArgs, readPortArg } from './application.service';
import * as globalConfigUtils from '../utils/global-config.utils';
import { webServerService } from './web-server.service';
import type { GlobalConfig } from '../utils/global-config.utils';

const config: GlobalConfig = {
  startWebServerOnLoad: true,
  webServerPort: 1234,
  authenticationEnabled: false,
  authenticationUsername: '',
  authenticationPassword: '',
  maxBackupDownloadSizeMB: 100
};

describe('readAuthArgs', () => {
  it('reads the flags', () => {
    expect(readAuthArgs(['--auth-enabled', '--username=ops', '--password=secret'], {}))
      .toEqual({ enabled: true, username: 'ops', password: 'secret' });
  });

  it('keeps everything after the first "=", so a password may contain one', () => {
    expect(readAuthArgs(['--password=a=b=c'], {}).password).toBe('a=b=c');
  });

  it('is off, with no login, when nothing is given', () => {
    expect(readAuthArgs([], {})).toEqual({ enabled: false, username: '', password: '' });
  });

  it('falls back to AASM_AUTH_ENABLED, AASM_USERNAME and AASM_PASSWORD', () => {
    // Docker passes the password this way so it never shows up in the process list.
    const env = { AASM_AUTH_ENABLED: 'true', AASM_USERNAME: 'ops', AASM_PASSWORD: 'from-env' };

    expect(readAuthArgs([], env)).toEqual({ enabled: true, username: 'ops', password: 'from-env' });
  });

  it('lets a flag win over the environment', () => {
    const env = { AASM_AUTH_ENABLED: 'false', AASM_USERNAME: 'env-user', AASM_PASSWORD: 'env-pass' };

    expect(readAuthArgs(['--auth-enabled', '--username=flag-user', '--password=flag-pass'], env))
      .toEqual({ enabled: true, username: 'flag-user', password: 'flag-pass' });
    expect(readAuthArgs(['--auth-enabled', '--username=flag-user'], env))
      .toEqual({ enabled: true, username: 'flag-user', password: 'env-pass' });
  });

  it('only turns authentication on for AASM_AUTH_ENABLED=true', () => {
    expect(readAuthArgs([], { AASM_AUTH_ENABLED: 'false' }).enabled).toBe(false);
    expect(readAuthArgs([], { AASM_AUTH_ENABLED: 'yes' }).enabled).toBe(false);
  });
});

describe('readPortArg', () => {
  it('reads --port', () => {
    expect(readPortArg(['--port=8080'])).toBe(8080);
  });

  it('is undefined without --port', () => {
    expect(readPortArg([])).toBeUndefined();
  });

  it.each(['--port=abc', '--port=0', '--port=65536', '--port=80x'])('ignores %s with a warning', arg => {
    expect(readPortArg([arg])).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(arg));
  });
});

describe('ApplicationService', () => {
  const argv = process.argv;
  const env = process.env;
  let startWebServer: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.AASM_AUTH_ENABLED;
    delete process.env.AASM_USERNAME;
    delete process.env.AASM_PASSWORD;
    startWebServer = jest.spyOn(webServerService, 'startWebServer').mockResolvedValue({ success: true, message: 'started', port: 1234 });
    jest.spyOn(globalConfigUtils, 'loadGlobalConfig').mockReturnValue(config);
  });

  afterEach(() => {
    process.argv = argv;
    process.env = env;
  });

  function initialize(...args: string[]) {
    process.argv = ['electron', 'main.js', ...args];
    return new ApplicationService().initializeApplication();
  }

  it('knows whether it runs headless', () => {
    process.argv = ['electron', 'main.js', '--headless'];
    expect(new ApplicationService().isHeadless()).toBe(true);

    process.argv = ['electron', 'main.js'];
    expect(new ApplicationService().isHeadless()).toBe(false);
  });

  it('starts the web server headless with the command-line login', async () => {
    const useCommandLineLogin = jest.spyOn(webServerService, 'useCommandLineLogin');

    await initialize('--headless', '--port=8080', '--auth-enabled', '--password=secret');

    expect(useCommandLineLogin).toHaveBeenCalledWith({ enabled: true, username: 'admin', password: 'secret' });
    expect(startWebServer).toHaveBeenCalledWith(8080, { enabled: true, username: 'admin', password: 'secret' });
  });

  it('takes the headless login from the environment when the flags are absent', async () => {
    Object.assign(process.env, { AASM_AUTH_ENABLED: 'true', AASM_USERNAME: 'ops', AASM_PASSWORD: 'from-env' });

    await initialize('--headless');

    expect(startWebServer).toHaveBeenCalledWith(1234, { enabled: true, username: 'ops', password: 'from-env' });
  });

  it('starts headless without authentication when none is asked for', async () => {
    await initialize('--headless');

    expect(startWebServer).toHaveBeenCalledWith(1234, { enabled: false, username: '', password: '' });
  });

  it('starts headless with authentication and no password, leaving sign-in to accounts', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await initialize('--headless', '--auth-enabled');

    expect(exit).not.toHaveBeenCalled();
    expect(startWebServer).toHaveBeenCalledWith(1234, { enabled: true, username: 'admin', password: '' });
  });

  it('starts the web server with the desktop app when configured to', async () => {
    await initialize();

    expect(startWebServer).toHaveBeenCalledWith(1234);
  });

  it('leaves the web server off in the desktop app unless configured', async () => {
    jest.mocked(globalConfigUtils.loadGlobalConfig).mockReturnValue({ ...config, startWebServerOnLoad: false });

    await initialize('--port=8080');

    expect(startWebServer).not.toHaveBeenCalled();
  });

  it('uses the configured port when --port is not a port', async () => {
    await initialize('--headless', '--port=abc');

    expect(startWebServer).toHaveBeenCalledWith(1234, expect.anything());
  });
});
