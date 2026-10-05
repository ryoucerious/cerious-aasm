// Before electron loads: AppImages mount chrome-sandbox under /tmp/.mount_*, where it can never be
// root:4755, and Ubuntu 24.04 then aborts with a setuid_sandbox_host FATAL.
import './sandbox-bootstrap';
import { execFileSync, execSync } from 'child_process';

const isHeadlessMode = process.argv.includes('--headless');
const isLinux = process.platform === 'linux';

// Headless Linux with no display: GTK can abort before any JavaScript runs. Packaged builds start
// through scripts/linux-electron-wrapper.sh, which runs xvfb-run first; this is the fallback for
// running the binary directly.
const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
if (isHeadlessMode && isLinux && !hasDisplay) {
  let hasXvfb = true;
  try {
    execSync('command -v xvfb-run', { stdio: 'ignore' });
  } catch {
    hasXvfb = false;
  }

  if (hasXvfb) {
    console.log('[main] No display in headless mode; relaunching under xvfb-run');
    try {
      execFileSync('xvfb-run', ['-a', process.argv[0], ...process.argv.slice(1)], { stdio: 'inherit' });
      process.exit(0);
    } catch (error) {
      process.exit((error as { status?: number }).status || 1);
    }
  } else {
    console.error(
      '[main] Headless mode on Linux needs a display server, and xvfb-run was not found. Install xvfb ' +
      '(sudo apt install xvfb, or sudo dnf install xorg-x11-server-Xvfb) or start through ' +
      'cerious-aasm-headless-appimage.sh.'
    );
    process.exit(1);
  }
}

import { app, BrowserWindow, IpcMainEvent, ipcMain, shell } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Also in the linux/appImage executableArgs, which Chromium reads at process start.
if (isLinux || isHeadlessMode) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
}

if (isHeadlessMode) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  // A server has no audio device; without this ALSA symbol lookups fail.
  app.commandLine.appendSwitch('disable-audio-output');
  // GTK faults without a display otherwise.
  app.disableHardwareAcceleration();
}

// Before the other app modules, so their console output reaches the log file too.
import { getLogFilePath } from './utils/logger';

import { automationService } from './services/automation/automation.service';
import { serverProcessService } from './services/server-instance/server-process.service';
import { cleanupOrphanedArkProcesses } from './utils/ark/ark-server/ark-server-cleanup.utils';
import { serverManagementService } from './services/server-instance/server-management.service';
import { messagingService } from './services/messaging.service';
import { webServerService } from './services/web-server.service';
import { applicationService, readAuthArgs } from './services/application.service';
import { LogService } from './services/log.service';
import { ArkUpdateService, stopSteamCmdQuery } from './services/ark-update.service';
import { autoUpdateService } from './services/auto-update.service';
import { playerHistoryService } from './services/player-history.service';
import { userDatabaseService } from './services/auth/user-database.service';
import { scopeBroadcast } from './services/auth/pool-broadcast';
import { cleanupAllRconConnections } from './utils/rcon.utils';
import { loadGlobalConfig } from './utils/global-config.utils';
import { releaseInstallLockIfHeld } from './utils/installer.utils';
import { setArkUpdateService } from './handlers/ark-update-handler';
import { initializeBackupSystem } from './handlers/backup-handler';

import './handlers/app-handler';
import './handlers/web-server-handler';
import './handlers/directory-handler';
import './handlers/message-handler';
import './handlers/install-handler';
import './handlers/automation-handler';
import './handlers/server-instance-handler';
import './handlers/settings-handler';
import './handlers/linux-deps-handler';
import './handlers/firewall-handler';
import './handlers/system-info-handler';
import './handlers/whitelist-handler';
import './handlers/config-import-export-handler';
import './handlers/auto-update-handler';
import './handlers/ark-api-handler';
import './handlers/curseforge-handler';
import './handlers/host-resources-handler';
import './handlers/user-handler';
import './handlers/activity-handler';
import './handlers/player-history-handler';

const DEV_SERVER_URL = 'http://localhost:4200';
const CLOSE_RESPONSE_TIMEOUT_MS = 10000;
const SHUTDOWN_MAX_WAIT_MS = 15000;
const SHUTDOWN_POLL_MS = 1000;

const arkUpdateService = new ArkUpdateService(messagingService);
setArkUpdateService(arkUpdateService);

let mainWindow: BrowserWindow | null = null;

// Before the sweep: a second launch would take the running instance's servers for orphans and kill them.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (isPrimaryInstance) {
  // Asynchronous: server starts wait for it, so it can never match a server this run starts.
  void cleanupOrphanedArkProcesses();
  app.on('second-instance', showRunningInstance);
} else {
  console.info('[main] Cerious AASM is already running; this launch exits.');
  app.quit();
}

process.on('uncaughtException', (error: NodeJS.ErrnoException) => {
  // A closed stdout or stderr (the launching terminal went away) is no reason to stop the servers.
  if (error?.code === 'EPIPE') {
    return;
  }
  console.error('[main] Uncaught exception:', error);
  cleanup();
  process.exit(1);
});

// Log only: exiting would take every running ARK server down, and some libraries (electron-updater
// among them) reject benignly in edge cases.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[main] Unhandled promise rejection at:', promise, 'reason:', reason);
});

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

process.on('beforeExit', () => {
  cleanup();
});

// Each step on its own, so one failure does not skip the rest.
function cleanup(): void {
  // A second launch owns nothing, and killAllProcesses sweeps the whole install on Linux, which
  // would reach the running instance's servers.
  if (!isPrimaryInstance) {
    return;
  }
  // First, so crash detection never sees the kills below as crashes to restart.
  try {
    automationService.cleanup();
  } catch (error) {
    console.error('[main] Error stopping automation:', error);
  }
  try {
    cleanupAllRconConnections();
  } catch (error) {
    console.error('[main] Error cleaning up RCON connections:', error);
  }
  try {
    webServerService.cleanup();
  } catch (error) {
    console.error('[main] Error cleaning up the web server:', error);
  }
  try {
    serverProcessService.killAllProcesses();
  } catch (error) {
    console.error('[main] Error stopping server processes:', error);
  }
  try {
    playerHistoryService.stop();
  } catch (error) {
    console.error('[main] Error stopping player history:', error);
  }
  try {
    arkUpdateService.stop();
  } catch (error) {
    console.error('[main] Error stopping the ARK update checks:', error);
  }
  // A build check's SteamCMD runs in a process group of its own and would outlive the app; the
  // lock goes after it, or the next start has to wait for the lock's heartbeat to run out.
  try {
    stopSteamCmdQuery();
    releaseInstallLockIfHeld();
  } catch (error) {
    console.error('[main] Error releasing the install lock:', error);
  }
  // Closing releases the on-disk lock; after a hard exit without it the next launch cannot open
  // the database at all.
  try {
    userDatabaseService.close();
  } catch (error) {
    console.error('[main] Error closing the user database:', error);
  }
}

function exitNow(): void {
  cleanup();
  app.exit(0);
}

// The renderer answers a shutdown only once its servers have stopped (or its own cap passed), so
// this is a short last wait for their processes before cleanup() kills whatever is left.
function exitOnceServersStop(): void {
  let waitedMs = 0;
  const check = () => {
    waitedMs += SHUTDOWN_POLL_MS;
    const active = serverProcessService.getActiveProcessCount();
    if (active > 0 && waitedMs < SHUTDOWN_MAX_WAIT_MS) {
      setTimeout(check, SHUTDOWN_POLL_MS);
      return;
    }
    if (active > 0) {
      console.warn(`[main] ${active} server(s) still running after ${SHUTDOWN_MAX_WAIT_MS} ms; exiting anyway`);
    }
    exitNow();
  };
  setTimeout(check, SHUTDOWN_POLL_MS);
}

/**
 * Closing asks the renderer with app-close-request, and it answers app-close-response
 * { action: 'shutdown' | 'exit' | 'cancel' }. The window itself never closes: only app.exit ends
 * it, so a second close (title bar X, Alt+F4) cannot tear it down mid-prompt or mid-shutdown.
 */
function confirmBeforeClosing(win: BrowserWindow): void {
  let pageLoaded = false;
  let pageResponsive = true;
  let awaitingResponse = false;
  let promptTimedOut = false;
  let exiting = false;
  let responseTimeout: NodeJS.Timeout | undefined;

  win.webContents.on('did-finish-load', () => { pageLoaded = true; });
  win.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    // -3 (ERR_ABORTED) is a navigation that was replaced or cancelled, e.g. by will-navigate.
    if (isMainFrame && errorCode !== -3) {
      pageLoaded = false;
    }
  });
  win.webContents.on('render-process-gone', () => { pageLoaded = false; });
  win.on('unresponsive', () => { pageResponsive = false; });
  win.on('responsive', () => { pageResponsive = true; });

  win.on('close', event => {
    event.preventDefault();
    if (exiting) {
      return;
    }
    // The window is frameless: with no page to answer the prompt it could never be closed. With no
    // server to stop a working page answers at once, so a timed-out prompt then means the app never
    // started. While servers run the exit dialog may be open or the renderer still stopping them.
    const appMissing = promptTimedOut && serverProcessService.getActiveProcessCount() === 0;
    if (!pageLoaded || !pageResponsive || appMissing) {
      console.warn('[main] The window cannot answer the close prompt; exiting without asking');
      exiting = true;
      clearTimeout(responseTimeout);
      exitOnceServersStop();
      return;
    }
    if (awaitingResponse) {
      return;
    }
    awaitingResponse = true;
    win.webContents.send('app-close-request');
    // A renderer that never answers must not leave closing disabled.
    responseTimeout = setTimeout(() => {
      awaitingResponse = false;
      promptTimedOut = true;
    }, CLOSE_RESPONSE_TIMEOUT_MS);
  });

  const onResponse = (event: IpcMainEvent, response: unknown) => {
    if (event.sender !== win.webContents || exiting) {
      return;
    }
    clearTimeout(responseTimeout);
    awaitingResponse = false;
    promptTimedOut = false;

    const action = (response as { action?: unknown } | null | undefined)?.action;
    if (action === 'shutdown') {
      exiting = true;
      exitOnceServersStop();
    } else if (action === 'exit') {
      exiting = true;
      exitNow();
    }
  };
  ipcMain.on('app-close-response', onResponse);

  win.on('closed', () => {
    clearTimeout(responseTimeout);
    ipcMain.removeListener('app-close-response', onResponse);
  });
}

// Per window and removed with it, so a window re-created on macOS 'activate' does not stack
// listeners. Close goes through win.close() so the running-servers prompt still applies.
function registerWindowControlHandlers(win: BrowserWindow): void {
  const sendMaximized = () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window-maximized-changed', win.isMaximized());
    }
  };

  const onMinimize = () => { if (!win.isDestroyed()) win.minimize(); };
  const onMaximizeToggle = () => {
    if (win.isDestroyed()) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  };
  const onClose = () => { if (!win.isDestroyed()) win.close(); };

  ipcMain.on('window-minimize', onMinimize);
  ipcMain.on('window-maximize-toggle', onMaximizeToggle);
  ipcMain.on('window-close', onClose);
  ipcMain.handle('window-is-maximized', () => !win.isDestroyed() && win.isMaximized());

  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);

  win.on('closed', () => {
    ipcMain.removeListener('window-minimize', onMinimize);
    ipcMain.removeListener('window-maximize-toggle', onMaximizeToggle);
    ipcMain.removeListener('window-close', onClose);
    ipcMain.removeHandler('window-is-maximized');
  });
}

// The window is frameless, with no address bar or way back, so a link must never replace the app;
// a foreign page would also inherit the preload bridge. Web links open in the OS browser instead.
function keepNavigationInApp(win: BrowserWindow, isAppUrl: (url: string) => boolean): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) {
      return;
    }
    event.preventDefault();
    openInBrowser(url);
  });
}

function isDevServerUrl(url: string): boolean {
  try {
    return new URL(url).origin === DEV_SERVER_URL;
  } catch {
    return false;
  }
}

// Only the index itself: any other local file would load with the preload bridge.
function isIndexFileUrl(url: string, indexPath: string): boolean {
  try {
    const target = new URL(url);
    if (target.protocol !== 'file:') {
      return false;
    }
    const requested = path.resolve(fileURLToPath(target));
    const index = path.resolve(indexPath);
    return process.platform === 'win32' ? requested.toLowerCase() === index.toLowerCase() : requested === index;
  } catch {
    return false;
  }
}

function openInBrowser(url: string): void {
  if (/^https?:\/\//i.test(url)) {
    shell.openExternal(url).catch(error => console.error('[main] Could not open a link in the browser:', error));
  }
}

function showRunningInstance(): void {
  if (applicationService.isHeadless()) {
    console.info('[main] Another launch found this instance already running and exited.');
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(): void {
  if (applicationService.isHeadless()) {
    return;
  }
  const isDev = process.env.NODE_ENV === 'development';
  const indexPath = path.join(app.getAppPath(), 'dist', 'cerious-aasm', 'browser', 'index.html');
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 940,
    minHeight: 600,
    // The app draws its own title bar (see WindowControlsComponent), so the native frame
    // is off. The window stays resizable; Electron keeps the invisible resize border.
    frame: false,
    backgroundColor: '#161d2b',
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), isLinux ? 'logo-square-256.png' : 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;

  messagingService.addWebContents(win.webContents);
  registerWindowControlHandlers(win);
  confirmBeforeClosing(win);
  keepNavigationInApp(win, url => (isDev ? isDevServerUrl(url) : isIndexFileUrl(url, indexPath)));
  win.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadFile(indexPath);
  }
}

// On first run there has to be a way in. The configured web login becomes an Admin account, and a
// machine with no screen gets one from the startup credentials: there is no window to create it in.
async function prepareAccounts(): Promise<void> {
  try {
    userDatabaseService.initialize();
    // Web clients only receive the broadcasts for their pool; main decides, the child matches.
    messagingService.scopeBroadcast = scopeBroadcast;
    const globalConfig = loadGlobalConfig();
    const startup = readAuthArgs();
    const authOn = !!globalConfig.authenticationEnabled || startup.enabled;
    const username = globalConfig.authenticationUsername || startup.username || 'admin';
    const password = globalConfig.authenticationPassword || startup.password;

    // A startup password (--password or AASM_PASSWORD) is this process's admin login: reapplied on
    // every start and not changeable in the app. Other accounts live under Settings > Users & Roles.
    if (startup.password) {
      const synced = await userDatabaseService.syncCliAdmin(startup.username || 'admin', startup.password);
      if (synced.success && synced.data) {
        console.info(`[main] Command-line admin "${synced.data.username}" is ready.`);
      } else if (!synced.success) {
        console.error(`[main] Could not apply the command-line admin password: ${synced.error}`);
      }
    } else if (!userDatabaseService.hasAnyUser() && authOn) {
      if (password) {
        const seeded = await userDatabaseService.seedFirstAdmin(username, password);
        if (seeded.success && seeded.data) {
          console.info(`[main] Created the "${seeded.data.username}" admin account from the configured web login.`);
        } else if (!seeded.success) {
          console.error(`[main] Could not create the first admin account: ${seeded.error}`);
        }
      } else {
        console.warn(
          '[main] Authentication is on but this install has no accounts, so nobody can sign in. ' +
          'Create one in the desktop app under Settings > Users & Roles, or start once with ' +
          '--auth-enabled --username=<name> --password=<password> (or AASM_USERNAME and AASM_PASSWORD) ' +
          'to create it here.'
        );
      }
    }
  } catch (error) {
    console.error('[main] Failed to initialize the user database:', error);
  }
}

async function playerCountsByInstance(): Promise<Record<string, number>> {
  const { instances } = await serverManagementService.getAllInstances();
  const counts: Record<string, number> = {};
  for (const instance of instances) {
    counts[instance.id] = instance.state === 'running' ? (instance.players || 0) : 0;
  }
  return counts;
}

app.on('ready', async () => {
  // A second launch is quitting, and 'ready' may still fire before it has.
  if (!isPrimaryInstance) {
    return;
  }
  console.info(`[main] Cerious AASM starting, log: ${getLogFilePath()}`);

  LogService.clearArkLogFiles();
  await applicationService.initializeApplication();

  createWindow();
  initializeBackupSystem().catch(error => console.error('[main] Backup system failed to start:', error));
  automationService.initializeAutomation();
  await prepareAccounts();

  // Feeds the dashboard's 24-hour player chart, once a minute.
  playerHistoryService.start(playerCountsByInstance);

  try {
    await arkUpdateService.initialize();
  } catch (error) {
    console.error('[main] ARK update checks did not start:', error);
  }

  if (process.env.NODE_ENV !== 'development') {
    autoUpdateService.checkForUpdates().catch(error => console.error('[main] App update check failed:', error));
    autoUpdateService.startPeriodicUpdateCheck();
  } else if (process.argv.includes('--test-update')) {
    autoUpdateService.simulateUpdateLifecycleForDev();
  }
});

// Only app.exit ends the window (see confirmBeforeClosing). Should it go some other way, exit the
// same way instead of leaving the servers running with no window.
app.on('window-all-closed', exitNow);

app.on('activate', () => {
  if (isPrimaryInstance && mainWindow === null && !applicationService.isHeadless()) {
    createWindow();
  }
});
