import { EventEmitter } from 'events';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { BrowserWindowConstructorOptions, HandlerDetails } from 'electron';

// Real path rules, so file URLs and the index path resolve the way they do in the app.
jest.unmock('path');

jest.mock('electron', () => {
  const { EventEmitter } = jest.requireActual<typeof import('events')>('events');
  return {
    app: Object.assign(new EventEmitter(), {
      getAppPath: jest.fn(() => '/app'),
      quit: jest.fn(),
      exit: jest.fn(),
      requestSingleInstanceLock: jest.fn(() => true),
      commandLine: { appendSwitch: jest.fn() },
      disableHardwareAcceleration: jest.fn(),
    }),
    BrowserWindow: jest.fn(),
    ipcMain: Object.assign(new EventEmitter(), { handle: jest.fn(), removeHandler: jest.fn() }),
    shell: { openExternal: jest.fn(() => Promise.resolve()) },
  };
});

jest.mock('./utils/logger', () => ({ getLogFilePath: jest.fn(() => '/logs/cerious-aasm.log') }));
jest.mock('./utils/rcon.utils', () => ({ cleanupAllRconConnections: jest.fn() }));
jest.mock('./utils/global-config.utils', () => ({ loadGlobalConfig: jest.fn(() => ({})) }));
jest.mock('./services/automation/automation.service', () => ({
  automationService: { initializeAutomation: jest.fn(), cleanup: jest.fn() },
}));
jest.mock('./utils/ark/ark-server/ark-server-cleanup.utils', () => ({ cleanupOrphanedArkProcesses: jest.fn() }));
jest.mock('./services/server-instance/server-process.service', () => ({
  serverProcessService: { killAllProcesses: jest.fn(), getActiveProcessCount: jest.fn(() => 0) },
}));
jest.mock('./services/server-instance/server-management.service', () => ({
  serverManagementService: { getAllInstances: jest.fn(async () => ({ instances: [] })) },
}));
jest.mock('./services/messaging.service', () => ({ messagingService: { addWebContents: jest.fn(), on: jest.fn() } }));
jest.mock('./services/web-server.service', () => ({ webServerService: { cleanup: jest.fn() } }));
jest.mock('./services/application.service', () => ({
  readAuthArgs: jest.requireActual('./services/application.service').readAuthArgs,
  applicationService: { isHeadless: jest.fn(() => false), initializeApplication: jest.fn(async () => undefined) },
}));
jest.mock('./services/log.service', () => ({ LogService: { clearArkLogFiles: jest.fn() } }));
jest.mock('./services/ark-update.service', () => ({
  ArkUpdateService: jest.fn(() => ({ initialize: jest.fn(async () => undefined), stop: jest.fn() })),
  bindArkUpdateService: jest.fn(),
  stopSteamCmdQuery: jest.fn(),
}));
jest.mock('./utils/installer.utils', () => ({ releaseInstallLockIfHeld: jest.fn() }));
jest.mock('./services/auto-update.service', () => ({
  autoUpdateService: {
    checkForUpdates: jest.fn(async () => undefined),
    startPeriodicUpdateCheck: jest.fn(),
    simulateUpdateLifecycleForDev: jest.fn(),
  },
}));
jest.mock('./services/player-history.service', () => ({ playerHistoryService: { start: jest.fn(), stop: jest.fn() } }));
jest.mock('./services/auth/user-database.service', () => ({
  userDatabaseService: {
    initialize: jest.fn(),
    hasAnyUser: jest.fn(() => true),
    syncCliAdmin: jest.fn(async (username: string) => ({ success: true, data: { username } })),
    seedFirstAdmin: jest.fn(),
    close: jest.fn(),
  },
}));
jest.mock('./handlers/ark-update-handler', () => ({ setArkUpdateService: jest.fn() }));
jest.mock('./handlers/backup-handler', () => ({ initializeBackupSystem: jest.fn(async () => undefined) }));
jest.mock('./handlers/app-handler', () => ({}));
jest.mock('./handlers/web-server-handler', () => ({}));
jest.mock('./handlers/directory-handler', () => ({}));
jest.mock('./handlers/message-handler', () => ({}));
jest.mock('./handlers/install-handler', () => ({}));
jest.mock('./handlers/automation-handler', () => ({}));
jest.mock('./handlers/server-instance-handler', () => ({}));
jest.mock('./handlers/settings-handler', () => ({}));
jest.mock('./handlers/linux-deps-handler', () => ({}));
jest.mock('./handlers/firewall-handler', () => ({}));
jest.mock('./handlers/system-info-handler', () => ({}));
jest.mock('./handlers/whitelist-handler', () => ({}));
jest.mock('./handlers/config-import-export-handler', () => ({}));
jest.mock('./handlers/auto-update-handler', () => ({}));
jest.mock('./handlers/ark-api-handler', () => ({}));
jest.mock('./handlers/curseforge-handler', () => ({}));
jest.mock('./handlers/host-resources-handler', () => ({}));
jest.mock('./handlers/user-handler', () => ({}));
jest.mock('./handlers/activity-handler', () => ({}));
jest.mock('./handlers/player-history-handler', () => ({}));
jest.mock('./handlers/mesh-handler', () => ({}));
jest.mock('./services/mesh/mesh-service', () => ({
  meshService: { noteMembership: jest.fn(), resumeIfJoined: jest.fn(async () => undefined), stop: jest.fn(async () => undefined) },
}));

class FakeWebContents extends EventEmitter {
  readonly send = jest.fn();
  readonly setWindowOpenHandler = jest.fn();

  /** Emits will-navigate as Electron does; true when no listener prevented it. */
  navigate(url: string): boolean {
    let allowed = true;
    this.emit('will-navigate', { preventDefault: () => { allowed = false; } }, url);
    return allowed;
  }

  closeRequests(): number {
    return this.send.mock.calls.filter(([channel]) => channel === 'app-close-request').length;
  }
}

class FakeWindow extends EventEmitter {
  readonly webContents = new FakeWebContents();
  readonly loadURL = jest.fn(() => { this.webContents.emit('did-finish-load'); });
  readonly loadFile = jest.fn(() => { this.webContents.emit('did-finish-load'); });
  readonly isMaximized = jest.fn(() => false);
  readonly isMinimized = jest.fn(() => false);
  readonly restore = jest.fn();
  readonly show = jest.fn();
  readonly focus = jest.fn();
  closed = false;

  constructor(readonly options: BrowserWindowConstructorOptions) {
    super();
  }

  isDestroyed(): boolean {
    return this.closed;
  }

  /** Like BrowserWindow.close(): the window goes away unless a close listener prevents it. */
  close(): void {
    let prevented = false;
    this.emit('close', { preventDefault: () => { prevented = true; } });
    if (!prevented) {
      this.closed = true;
      this.emit('closed');
    }
  }
}

type ProcessListener = (...args: unknown[]) => void;

const savedEnv = { ...process.env };
const savedArgv = process.argv;
const savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const indexPath = path.join('/app', 'dist', 'cerious-aasm', 'browser', 'index.html');

function loadMain({ lockGranted = true } = {}) {
  jest.resetModules();
  const electron = jest.requireMock<typeof import('electron')>('electron');
  jest.mocked(electron.app.requestSingleInstanceLock).mockReturnValue(lockGranted);
  const windows: FakeWindow[] = [];
  jest.mocked(electron.BrowserWindow).mockImplementation(options => {
    const win = new FakeWindow(options ?? {});
    windows.push(win);
    return win as unknown as Electron.BrowserWindow;
  });

  require('./main');

  return {
    app: electron.app as unknown as EventEmitter & { exit: jest.Mock; quit: jest.Mock; requestSingleInstanceLock: jest.Mock },
    ipcMain: electron.ipcMain as unknown as EventEmitter,
    openExternal: jest.mocked(electron.shell.openExternal),
    windows,
    applicationService: jest.mocked(jest.requireMock<typeof import('./services/application.service')>('./services/application.service').applicationService),
    userDatabaseService: jest.mocked(jest.requireMock<typeof import('./services/auth/user-database.service')>('./services/auth/user-database.service').userDatabaseService),
    playerHistoryService: jest.mocked(jest.requireMock<typeof import('./services/player-history.service')>('./services/player-history.service').playerHistoryService),
    serverProcessService: jest.mocked(jest.requireMock<typeof import('./services/server-instance/server-process.service')>('./services/server-instance/server-process.service').serverProcessService),
    cleanupOrphanedArkProcesses: jest.mocked(jest.requireMock<typeof import('./utils/ark/ark-server/ark-server-cleanup.utils')>('./utils/ark/ark-server/ark-server-cleanup.utils').cleanupOrphanedArkProcesses),
    automationService: jest.mocked(jest.requireMock<typeof import('./services/automation/automation.service')>('./services/automation/automation.service').automationService),
    autoUpdateService: jest.mocked(jest.requireMock<typeof import('./services/auto-update.service')>('./services/auto-update.service').autoUpdateService),
    webServerService: jest.mocked(jest.requireMock<typeof import('./services/web-server.service')>('./services/web-server.service').webServerService),
    meshService: jest.mocked(jest.requireMock<typeof import('./services/mesh/mesh-service')>('./services/mesh/mesh-service').meshService),
    cleanupAllRconConnections: jest.mocked(jest.requireMock<typeof import('./utils/rcon.utils')>('./utils/rcon.utils').cleanupAllRconConnections),
    stopSteamCmdQuery: jest.mocked(jest.requireMock<typeof import('./services/ark-update.service')>('./services/ark-update.service').stopSteamCmdQuery),
    releaseInstallLockIfHeld: jest.mocked(jest.requireMock<typeof import('./utils/installer.utils')>('./utils/installer.utils').releaseInstallLockIfHeld),
    arkUpdateService: jest.mocked(jest.requireMock<typeof import('./services/ark-update.service')>('./services/ark-update.service').ArkUpdateService).mock.results[0]?.value as { stop: jest.Mock },
  };
}

type Main = ReturnType<typeof loadMain>;

async function emitReady(main: Main): Promise<FakeWindow> {
  const [onReady] = main.app.listeners('ready') as Array<() => Promise<void>>;
  await onReady();
  return main.windows[0];
}

function answer(main: Main, from: FakeWebContents, action: string): void {
  main.ipcMain.emit('app-close-response', { sender: from }, { action });
}

describe('main', () => {
  let processOn: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    processOn = jest.spyOn(process, 'on').mockImplementation(() => process);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    process.argv = savedArgv;
    Object.defineProperty(process, 'platform', savedPlatform);
    jest.useRealTimers();
  });

  function processListener(event: string): ProcessListener {
    const registration = processOn.mock.calls.find(([name]) => name === event);
    return registration![1] as ProcessListener;
  }

  describe('startup', () => {
    it('clears out ARK processes left behind by a previous run', () => {
      const main = loadMain();

      expect(main.cleanupOrphanedArkProcesses).toHaveBeenCalled();
    });

    // The web server starts with the application and the window asks who is signed in as soon as
    // it opens; a mesh member must already be asking for a mesh account by then.
    it('notes mesh membership before the web server or the window can start', async () => {
      const main = loadMain();

      await emitReady(main);

      expect(main.meshService.noteMembership.mock.invocationCallOrder[0])
        .toBeLessThan(main.applicationService.initializeApplication.mock.invocationCallOrder[0]);
    });

    it('takes the single-instance lock before looking for orphaned ARK processes', () => {
      const main = loadMain();

      expect(main.app.requestSingleInstanceLock.mock.invocationCallOrder[0])
        .toBeLessThan(main.cleanupOrphanedArkProcesses.mock.invocationCallOrder[0]);
    });

    it('quits without touching any process when another instance is running', async () => {
      // Its servers would look like orphans to this launch's sweep.
      const main = loadMain({ lockGranted: false });

      await emitReady(main);

      expect(main.cleanupOrphanedArkProcesses).not.toHaveBeenCalled();
      expect(main.app.quit).toHaveBeenCalled();
      expect(main.applicationService.initializeApplication).not.toHaveBeenCalled();
      expect(main.windows).toHaveLength(0);
    });

    // killAllProcesses sweeps the whole install on Linux, which would reach the running instance's servers.
    it('stops nothing on its way out when another instance is running', () => {
      const main = loadMain({ lockGranted: false });
      const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as () => never);

      processListener('SIGTERM')();
      main.app.emit('window-all-closed');

      expect(main.serverProcessService.killAllProcesses).not.toHaveBeenCalled();
      expect(main.webServerService.cleanup).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(0);
    });

    it('brings the window forward when the app is launched again', async () => {
      const main = loadMain();
      const win = await emitReady(main);
      win.isMinimized.mockReturnValue(true);

      main.app.emit('second-instance');

      expect(win.restore).toHaveBeenCalled();
      expect(win.show).toHaveBeenCalled();
      expect(win.focus).toHaveBeenCalled();
    });

    it('logs a second launch when headless', async () => {
      const main = loadMain();
      main.applicationService.isHeadless.mockReturnValue(true);
      await emitReady(main);

      main.app.emit('second-instance');

      expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/^\[main\] .*already running/));
    });

    it('logs where the log file is, in plain ASCII', async () => {
      const main = loadMain();

      await emitReady(main);

      expect(console.info).toHaveBeenCalledWith('[main] Cerious AASM starting, log: /logs/cerious-aasm.log');
    });

    it('applies a password given only through AASM_PASSWORD as the admin login', async () => {
      // The Docker entrypoint keeps the password out of argv, where any process could read it.
      process.env.AASM_PASSWORD = 'from-env';
      const main = loadMain();

      await emitReady(main);

      expect(main.userDatabaseService.syncCliAdmin).toHaveBeenCalledWith('admin', 'from-env');
    });

    it('plays the update simulation instead of checking in development with --test-update', async () => {
      process.env.NODE_ENV = 'development';
      process.argv = [...savedArgv, '--test-update'];
      const main = loadMain();

      await emitReady(main);

      expect(main.autoUpdateService.simulateUpdateLifecycleForDev).toHaveBeenCalled();
      expect(main.autoUpdateService.checkForUpdates).not.toHaveBeenCalled();
    });

    it('ignores EPIPE but cleans up and exits on any other uncaught exception', () => {
      const main = loadMain();
      const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as () => never);
      const onUncaught = processListener('uncaughtException');

      onUncaught(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      expect(exit).not.toHaveBeenCalled();

      onUncaught(new Error('boom'));
      expect(main.serverProcessService.killAllProcesses).toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  describe('window', () => {
    it('runs the page sandboxed and without Node, behind the preload bridge', async () => {
      const win = await emitReady(loadMain());

      expect(win.options.webPreferences).toEqual({
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      });
    });

    it('loads the built index, or the dev server in development', async () => {
      const packaged = await emitReady(loadMain());
      expect(packaged.loadFile).toHaveBeenCalledWith(indexPath);

      process.env.NODE_ENV = 'development';
      const dev = await emitReady(loadMain());
      expect(dev.loadURL).toHaveBeenCalledWith('http://localhost:4200');
    });

    it('opens no window when headless', async () => {
      const main = loadMain();
      main.applicationService.isHeadless.mockReturnValue(true);

      await emitReady(main);

      expect(main.windows).toHaveLength(0);
    });

    it('keeps navigation inside the app and sends web links to the browser', async () => {
      const main = loadMain();
      const { webContents } = await emitReady(main);

      expect(webContents.navigate(`${pathToFileURL(indexPath).href}#/servers`)).toBe(true);
      expect(webContents.navigate('https://github.com/ryoucerious/cerious-aasm')).toBe(false);
      expect(main.openExternal).toHaveBeenCalledWith('https://github.com/ryoucerious/cerious-aasm');
      expect(webContents.navigate('data:text/html,<p>elsewhere</p>')).toBe(false);
      expect(main.openExternal).toHaveBeenCalledTimes(1);
    });

    it('allows no local file but the index it loaded', async () => {
      const { webContents } = await emitReady(loadMain());

      expect(webContents.navigate('file:///C:/Windows/win.ini')).toBe(false);
      expect(webContents.navigate(pathToFileURL(path.join('/app', 'dist', 'cerious-aasm', 'browser', 'other.html')).href)).toBe(false);
      expect(webContents.navigate('file://fileserver/share/index.html')).toBe(false);
    });

    it('compares the index path without regard to case on Windows', async () => {
      const { webContents } = await emitReady(loadMain());
      const shouted = pathToFileURL(indexPath.toUpperCase()).href;

      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(webContents.navigate(shouted)).toBe(true);

      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(webContents.navigate(shouted)).toBe(false);
    });

    it('in development, allows only the dev server', async () => {
      process.env.NODE_ENV = 'development';
      const main = loadMain();
      const { webContents } = await emitReady(main);

      expect(webContents.navigate('http://localhost:4200/#/servers')).toBe(true);
      expect(webContents.navigate('file:///C:/Windows/win.ini')).toBe(false);
      expect(webContents.navigate('http://localhost:4201/')).toBe(false);
    });

    it('opens new-window links in the browser instead', async () => {
      const main = loadMain();
      const { webContents } = await emitReady(main);
      const [openHandler] = webContents.setWindowOpenHandler.mock.calls[0] as [(details: Pick<HandlerDetails, 'url'>) => unknown];

      expect(openHandler({ url: 'https://example.com/docs' })).toEqual({ action: 'deny' });
      expect(openHandler({ url: 'file:///C:/Windows/win.ini' })).toEqual({ action: 'deny' });
      expect(main.openExternal).toHaveBeenCalledTimes(1);
      expect(main.openExternal).toHaveBeenCalledWith('https://example.com/docs');
    });
  });

  describe('closing', () => {
    let main: Main;
    let win: FakeWindow;

    beforeEach(async () => {
      jest.useFakeTimers();
      main = loadMain();
      win = await emitReady(main);
    });

    it('asks the renderer first and keeps the window open', () => {
      win.close();

      expect(win.closed).toBe(false);
      expect(win.webContents.closeRequests()).toBe(1);
    });

    it('keeps the window open on a second close while the first is unanswered', () => {
      win.close();
      main.ipcMain.emit('window-close', { sender: win.webContents });

      expect(win.closed).toBe(false);
      expect(win.webContents.closeRequests()).toBe(1);
    });

    it('asks again when the renderer has not answered within 10 s while servers run', () => {
      // The exit dialog may still be open, or the renderer may be stopping the servers before it answers.
      main.serverProcessService.getActiveProcessCount.mockReturnValue(1);
      win.close();
      jest.advanceTimersByTime(9999);
      win.close();
      expect(win.webContents.closeRequests()).toBe(1);

      jest.advanceTimersByTime(1);
      win.close();
      expect(win.webContents.closeRequests()).toBe(2);
      jest.advanceTimersByTime(20000);
      expect(win.closed).toBe(false);
      expect(main.app.exit).not.toHaveBeenCalled();
    });

    it('exits without asking after a prompt went unanswered with no server running', () => {
      // With nothing to stop, a working renderer answers at once: the page loaded but the app did not start.
      main.serverProcessService.getActiveProcessCount.mockReturnValue(0);
      win.close();
      jest.advanceTimersByTime(10000);
      win.close();

      expect(win.webContents.closeRequests()).toBe(1);
      jest.advanceTimersByTime(1000);
      expect(main.userDatabaseService.close).toHaveBeenCalled();
      expect(main.app.exit).toHaveBeenCalledWith(0);
    });

    it('asks again after a timed-out prompt once the renderer has answered', () => {
      main.serverProcessService.getActiveProcessCount.mockReturnValue(0);
      win.close();
      jest.advanceTimersByTime(10000);
      answer(main, win.webContents, 'cancel');
      win.close();

      expect(win.webContents.closeRequests()).toBe(2);
      jest.advanceTimersByTime(1000);
      expect(main.app.exit).not.toHaveBeenCalled();
    });

    it('exits after cleaning up when the renderer answers exit', () => {
      win.close();
      answer(main, win.webContents, 'exit');

      expect(main.cleanupAllRconConnections).toHaveBeenCalled();
      expect(main.webServerService.cleanup).toHaveBeenCalled();
      expect(main.serverProcessService.killAllProcesses).toHaveBeenCalled();
      expect(main.userDatabaseService.close).toHaveBeenCalled();
      expect(main.app.exit).toHaveBeenCalledWith(0);
    });

    // A build check's SteamCMD runs in its own process group, and an install lock left on disk
    // would have to wait out its heartbeat at the next start.
    it('stops the ARK update poll and any pending update countdown when it exits', () => {
      win.close();
      answer(main, win.webContents, 'exit');

      expect(main.arkUpdateService.stop).toHaveBeenCalled();
    });

    it('stops a running build check, then releases the install lock, when it exits', () => {
      win.close();
      answer(main, win.webContents, 'exit');

      expect(main.stopSteamCmdQuery).toHaveBeenCalled();
      expect(main.releaseInstallLockIfHeld).toHaveBeenCalled();
      expect(main.stopSteamCmdQuery.mock.invocationCallOrder[0]).toBeLessThan(main.releaseInstallLockIfHeld.mock.invocationCallOrder[0]);
    });

    it('still honours an answer that arrives after the prompt timed out', () => {
      // The user can sit on the exit dialog for longer than the timeout.
      win.close();
      jest.advanceTimersByTime(30000);
      answer(main, win.webContents, 'exit');

      expect(main.app.exit).toHaveBeenCalledWith(0);
    });

    it('ignores answers from any other page', () => {
      win.close();
      answer(main, new FakeWebContents(), 'exit');

      expect(main.app.exit).not.toHaveBeenCalled();
    });

    it('asks again on the next close after a cancel', () => {
      win.close();
      answer(main, win.webContents, 'cancel');
      win.close();

      expect(win.webContents.closeRequests()).toBe(2);
      expect(main.app.exit).not.toHaveBeenCalled();
    });

    it('exits once the servers have stopped after a shutdown answer', () => {
      main.serverProcessService.getActiveProcessCount.mockReturnValueOnce(1).mockReturnValue(0);
      win.close();
      answer(main, win.webContents, 'shutdown');

      jest.advanceTimersByTime(1999);
      expect(main.app.exit).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(main.userDatabaseService.close).toHaveBeenCalled();
      expect(main.app.exit).toHaveBeenCalledWith(0);
      expect(win.webContents.send).not.toHaveBeenCalledWith('shutdown-all-servers');
    });

    it('forces the exit 15 s after a shutdown answer with servers still running', () => {
      main.serverProcessService.getActiveProcessCount.mockReturnValue(2);
      win.close();
      answer(main, win.webContents, 'shutdown');

      jest.advanceTimersByTime(14999);
      expect(main.app.exit).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(main.app.exit).toHaveBeenCalledWith(0);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('2 server(s) still running'));
    });

    it('keeps the window open and stops prompting while the shutdown runs', () => {
      main.serverProcessService.getActiveProcessCount.mockReturnValue(1);
      win.close();
      answer(main, win.webContents, 'shutdown');

      jest.advanceTimersByTime(10000);
      main.ipcMain.emit('window-close', { sender: win.webContents });
      answer(main, win.webContents, 'exit');

      expect(win.closed).toBe(false);
      expect(win.webContents.closeRequests()).toBe(1);
      expect(main.app.exit).not.toHaveBeenCalled();
    });

    it('exits without asking, once, after the renderer is gone', () => {
      // The window is frameless: with nobody to answer the prompt it could never be closed.
      win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
      win.close();
      win.close();

      expect(win.closed).toBe(false);
      expect(win.webContents.closeRequests()).toBe(0);
      jest.advanceTimersByTime(20000);
      expect(main.userDatabaseService.close).toHaveBeenCalled();
      expect(main.app.exit).toHaveBeenCalledTimes(1);
    });

    it('still waits up to 15 s for servers to stop when closing without asking', () => {
      main.serverProcessService.getActiveProcessCount.mockReturnValue(1);
      win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
      win.close();

      jest.advanceTimersByTime(14999);
      expect(main.app.exit).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(main.app.exit).toHaveBeenCalledWith(0);
    });

    it('exits without asking when the page hangs with the prompt open', () => {
      win.close();
      win.emit('unresponsive');
      win.close();

      jest.advanceTimersByTime(1000);
      expect(win.webContents.closeRequests()).toBe(1);
      expect(main.app.exit).toHaveBeenCalledWith(0);
    });

    it('asks again once a hung page responds', () => {
      win.emit('unresponsive');
      win.emit('responsive');
      win.close();

      jest.advanceTimersByTime(20000);
      expect(win.webContents.closeRequests()).toBe(1);
      expect(main.app.exit).not.toHaveBeenCalled();
    });

    it('exits without asking when the page failed to load', () => {
      win.webContents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:4200/', true);
      win.close();

      jest.advanceTimersByTime(1000);
      expect(win.webContents.closeRequests()).toBe(0);
      expect(main.app.exit).toHaveBeenCalledWith(0);
    });

    it('still asks after an aborted navigation or a failed subframe', () => {
      win.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://example.com/', true);
      win.webContents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://example.com/', false);
      win.close();

      jest.advanceTimersByTime(1000);
      expect(win.webContents.closeRequests()).toBe(1);
      expect(main.app.exit).not.toHaveBeenCalled();
    });

    it('stops listening for answers once the window is gone', () => {
      win.close();
      win.emit('closed');

      expect(main.ipcMain.listenerCount('app-close-response')).toBe(0);
    });

    it('closes the user database even when player history fails to stop', () => {
      // An unclosed database keeps its on-disk lock, and the next launch cannot open it.
      main.playerHistoryService.stop.mockImplementation(() => { throw new Error('stop failed'); });
      win.close();
      answer(main, win.webContents, 'exit');

      expect(main.userDatabaseService.close).toHaveBeenCalled();
      expect(main.app.exit).toHaveBeenCalledWith(0);
    });
  });

  it('cleans up and exits like any other exit if the window ever goes away without the prompt', () => {
    const main = loadMain();

    main.app.emit('window-all-closed');

    expect(main.automationService.cleanup).toHaveBeenCalled();
    expect(main.cleanupAllRconConnections).toHaveBeenCalled();
    expect(main.webServerService.cleanup).toHaveBeenCalled();
    expect(main.serverProcessService.killAllProcesses).toHaveBeenCalled();
    expect(main.releaseInstallLockIfHeld).toHaveBeenCalled();
    expect(main.userDatabaseService.close).toHaveBeenCalled();
    expect(main.app.exit).toHaveBeenCalledWith(0);
  });

  it('stops crash detection before it kills the servers, so the kill is never restarted as a crash', () => {
    const main = loadMain();
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as () => never);

    processListener('SIGTERM')();

    expect(main.automationService.cleanup.mock.invocationCallOrder[0])
      .toBeLessThan(main.serverProcessService.killAllProcesses.mock.invocationCallOrder[0]);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
