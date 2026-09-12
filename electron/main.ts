// =========================
// Command Line Arguments & Sandbox Configuration
// MUST BE FIRST - Before any Electron imports!
// =========================
// Disable Chromium SUID sandbox on Linux before Electron loads.
// AppImages mount chrome-sandbox under /tmp/.mount_* where root:4755 is
// impossible; Ubuntu 24.04 then aborts with setuid_sandbox_host FATAL.
import './sandbox-bootstrap';

// Check if running in headless mode or if we need to disable sandbox
const isHeadlessMode = process.argv.includes('--headless');
const isLinux = process.platform === 'linux';

// =========================
// Headless Linux: ensure a display server is available (best-effort fallback)
// GTK can initialise at the native Electron binary level BEFORE any JavaScript
// runs, aborting with: Gtk-ERROR: Can't create a GtkStyleContext without a
// display connection.  Packaged Linux builds install a shell entrypoint
// (scripts/linux-electron-wrapper.sh via afterPack) that runs xvfb-run before
// the binary starts — that is the reliable fix.  This block remains as a
// fallback when the .bin is invoked directly and JS still gets a chance to run.
// =========================
const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
if (isHeadlessMode && isLinux && !hasDisplay) {
  const { execFileSync, execSync } = require('child_process');

  // Check if xvfb-run is available
  let hasXvfb = false;
  try {
    execSync('command -v xvfb-run', { stdio: 'ignore' });
    hasXvfb = true;
  } catch (_) {}

  if (hasXvfb) {
    // Re-exec ourselves under xvfb-run — this replaces the current process
    console.log('[main] No DISPLAY detected in headless mode — re-launching via xvfb-run');
    try {
      const args = ['-a', process.argv[0], ...process.argv.slice(1)];
      execFileSync('xvfb-run', args, { stdio: 'inherit' });
      process.exit(0);
    } catch (e: any) {
      // execFileSync throws on non-zero exit; propagate the exit code
      process.exit(e.status || 1);
    }
  } else {
    console.error('[main] ERROR: No display server and xvfb-run not found.');
    console.error('  Headless mode on Linux requires a virtual framebuffer.');
    console.error('  Install xvfb:  sudo apt install xvfb   (Debian/Ubuntu)');
    console.error('                 sudo dnf install xorg-x11-server-Xvfb  (Fedora/RHEL)');
    console.error('  Or use the provided wrapper script: cerious-aasm-headless-appimage.sh');
    process.exit(1);
  }
}

// =========================
// Core Dependencies
// =========================
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// Apply sandbox fixes immediately after app import (also passed via
// linux/appImage executableArgs so Chromium sees them at process start)
if (isLinux || isHeadlessMode) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
}

// Additional stability switches for headless mode
if (isHeadlessMode) {
  app.commandLine.appendSwitch('disable-gpu'); // No dash prefix for value key, but for switch it is fine
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  // Prevent ALSA symbol lookup errors on headless Linux servers (no audio needed)
  app.commandLine.appendSwitch('disable-audio-output');
  // Crucial for headless environments to prevent GTK faults
  app.disableHardwareAcceleration();
}

// =========================
// Logging
// Must be initialised before all other imports so console.* is overridden
// for every subsequent module load.
// =========================
import { getLogFilePath } from './utils/logger';

// =========================
// Services
// =========================
import { automationService } from './services/automation/automation.service';
import { serverInstanceService } from './services/server-instance/server-instance.service';
import { serverLifecycleService } from './services/server-instance/server-lifecycle.service';
import { messagingService } from './services/messaging.service';
import { webServerService } from './services/web-server.service';
import { applicationService } from './services/application.service';
import { LogService } from './services/log.service';

// =========================
// Utilities & Handlers
// =========================
import { cleanupAllRconConnections } from './utils/rcon.utils';
import { ArkUpdateService } from './services/ark-update.service';
import { setArkUpdateService } from './handlers/ark-update-handler';
import { initializeBackupSystem } from './handlers/backup-handler';
import { autoUpdateService } from './services/auto-update.service';

// =========================
// Handler Imports (side effects)
// =========================
import './handlers/web-server-handler';
import './handlers/directory-handler';
import './handlers/message-handler';
import './handlers/install-handler';
import './handlers/automation-handler';
import './handlers/ark-update-handler';
import './handlers/server-instance-handler';
import './handlers/settings-handler';
import './handlers/backup-handler';
import './handlers/proton-handler';
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
import { playerHistoryService } from './services/player-history.service';
import { userDatabaseService } from './services/auth/user-database.service';
import { loadGlobalConfig } from './utils/global-config.utils';
import { platformService } from './services/platform.service';

// =========================
// Service Initialization
// =========================
const arkUpdateService = new ArkUpdateService(messagingService);
setArkUpdateService(arkUpdateService);


// =========================
// Application State
// =========================
let mainWindow: BrowserWindow | null = null;

// =========================
// Startup Cleanup
// =========================
// Clean up any orphaned processes from previous crashes
serverInstanceService.cleanupOrphanedArkProcesses();

// =========================
// Error Handling
// =========================
process.on('uncaughtException', (err) => {
  if (err && typeof err === 'object' && 'code' in err && (err as any).code === 'EPIPE') {
    return;
  }
  console.error('[main] Uncaught exception:', err);
  cleanup();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  // Log but do NOT exit — some third-party libraries (e.g. electron-updater)
  // can emit unhandled rejections in edge cases that are benign.
  // Calling process.exit(1) here would kill all running ARK servers and crash
  // the app whenever any library has an uncaught async error.
  console.error('[main] Unhandled promise rejection at:', promise, 'reason:', reason);
});

// =========================
// Process Cleanup
// =========================
const cleanup = () => {
  try {
    cleanupAllRconConnections();
  } catch (e) {
    console.error('[main] Error cleaning up RCON connections:', e);
  }

  try {
    webServerService.cleanup();
  } catch (e) {
    console.error('[main] Error cleaning up web server:', e);
  }

  try {
    require('./services/server-instance/server-process.service').serverProcessService.cleanupOrphanedProcesses();
  } catch (e) {}
  try {
    // Closing releases the on-disk lock. Without this a hard exit leaves it behind and the
    // next launch cannot open the database at all.
    playerHistoryService.stop();
    userDatabaseService.close();
  } catch (e) {
    console.error('[main] Error closing the database:', e);
  }
};

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


// =========================
// Window Management
// =========================
/**
 * Wires the custom title bar's buttons to the window.
 *
 * Registered per window and torn down with it, so a re-created window (macOS 'activate')
 * does not stack duplicate listeners. Close goes through win.close() rather than app.exit
 * so the existing "servers are still running" confirmation still runs.
 */
/**
 * The authentication flags, as given on the command line.
 *
 * A headless machine has no window to create the first account from, so the credentials
 * passed at startup are what seeds it.
 */
function readAuthArgs(): { enabled: boolean; username: string; password: string } {
  const valueOf = (flag: string): string => {
    const arg = process.argv.find(a => a.startsWith(`${flag}=`));
    return arg ? arg.slice(flag.length + 1) : '';
  };
  return {
    enabled: process.argv.includes('--auth-enabled'),
    username: valueOf('--username'),
    password: valueOf('--password')
  };
}

function registerWindowControlHandlers(win: Electron.BrowserWindow) {
  const send = () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window-maximized-changed', win.isMaximized());
    }
  };

  const onMinimize = () => { if (!win.isDestroyed()) win.minimize(); };
  const onMaximizeToggle = () => {
    if (win.isDestroyed()) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  };
  const onClose = () => { if (!win.isDestroyed()) win.close(); };

  ipcMain.on('window-minimize', onMinimize);
  ipcMain.on('window-maximize-toggle', onMaximizeToggle);
  ipcMain.on('window-close', onClose);
  ipcMain.handle('window-is-maximized', () => !win.isDestroyed() && win.isMaximized());

  win.on('maximize', send);
  win.on('unmaximize', send);

  win.on('closed', () => {
    ipcMain.removeListener('window-minimize', onMinimize);
    ipcMain.removeListener('window-maximize-toggle', onMaximizeToggle);
    ipcMain.removeListener('window-close', onClose);
    ipcMain.removeHandler('window-is-maximized');
  });
}

function createWindow() {
  if (applicationService.isHeadless()) {
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 940,
    minHeight: 600,
    // The app draws its own title bar (see WindowControlsComponent), so the native frame
    // is off. The window stays resizable; Electron keeps the invisible resize border.
    frame: false,
    backgroundColor: '#161d2b',
    autoHideMenuBar: true, // Hide the menu bar
    icon: path.join(app.getAppPath(), isLinux ? 'logo-square-256.png' : 'logo.png'), // Set app icon
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  messagingService.addWebContents(mainWindow.webContents);
  registerWindowControlHandlers(mainWindow);
  
  // In development, load from the dev server. In production, load from built files.
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:4200');
  } else {
    // Load the built Angular files directly from the file system
    // In production/packaged app, we need to resolve the correct path to the Angular files
    const appPath = app.getAppPath();
    const indexPath = path.join(appPath, 'dist', 'cerious-aasm', 'browser', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  // A link in the UI opens in the OS browser. The app window is frameless and has no
  // address bar or way back, so letting one navigate inside it would strand the user.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' as const };
  });

  // Intercept close event for shutdown modal (robust IPC protocol)
  let awaitingCloseResponse = false;
  mainWindow.on('close', async (e) => {
    if (mainWindow && !awaitingCloseResponse) {
      e.preventDefault();
      awaitingCloseResponse = true;
      mainWindow.webContents.send('app-close-request');
      ipcMain.once('app-close-response', (_event: any, data: any) => {
        awaitingCloseResponse = false;
        if (data && data.action === 'shutdown') {
          if (mainWindow) {
            mainWindow.webContents.send('shutdown-all-servers');
          }
          // The frontend already initiated shutdownAllServers() before sending this response.
          // Allow time for servers to gracefully stop, then force exit.
          const maxWaitMs = 15000;
          const checkInterval = 1000;
          let elapsed = 0;
          const checkAndExit = () => {
            elapsed += checkInterval;
            const serverProcessService = require('./services/server-instance/server-process.service').serverProcessService;
            const activeCount = serverProcessService.getActiveProcessCount?.() ?? 0;
            if (activeCount === 0 || elapsed >= maxWaitMs) {
              if (elapsed >= maxWaitMs) {
                console.warn(`[main] Shutdown timeout (${maxWaitMs}ms) reached with ${activeCount} servers still active — forcing exit`);
              }
              cleanup();
              app.exit(0);
            } else {
              setTimeout(checkAndExit, checkInterval);
            }
          };
          setTimeout(checkAndExit, checkInterval);
        } else if (data && data.action === 'exit') {
          cleanup();
          app.exit(0);
        }
        // else (cancel) do nothing
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// =========================
// Application Event Handlers
// =========================
app.on('ready', async () => {
  console.info(`[main] ====== Cerious AASM starting — log: ${getLogFilePath()} ======`);

  // Clear ARK log files before starting servers
  LogService.clearArkLogFiles();

  // Initialize application (handles headless mode and web server startup)
  await applicationService.initializeApplication();

  // Expose log file path to renderer / web clients
  messagingService.on('get-log-file-path', (_payload: any, sender: any) => {
    messagingService.sendToOriginator('get-log-file-path', { path: getLogFilePath() }, sender);
  });

  createWindow();
  // Initialize backup system
  initializeBackupSystem().catch(console.error);
  // Initialize automation system
  automationService.initializeAutomation();

  // Accounts: open the database and, on first run, make sure there is a way in. The single
  // configured web login becomes an Admin account, and on a machine with no screen the
  // credentials given on the command line do the same — there is no window to create one in.
  try {
    userDatabaseService.initialize();
    const globalConfig = loadGlobalConfig();
    const cli = readAuthArgs();
    const authOn = !!globalConfig.authenticationEnabled || cli.enabled;
    const username = globalConfig.authenticationUsername || cli.username || 'admin';
    const password = globalConfig.authenticationPassword || cli.password;

    if (!userDatabaseService.hasAnyUser() && authOn) {
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
          '--auth-enabled --username=<name> --password=<password> to create it here.'
        );
      }
    }
  } catch (error) {
    console.error('[main] Failed to initialize the user database:', error);
  }

  // Record player counts once a minute for the dashboard's 24-hour activity chart
  playerHistoryService.start(async () => {
    const { serverManagementService } = require('./services/server-instance/server-management.service');
    const { instances } = await serverManagementService.getAllInstances();
    const counts: Record<string, number> = {};
    for (const instance of instances) {
      counts[instance.id] = instance.state === 'running' ? (instance.players || 0) : 0;
    }
    return counts;
  });

  // Start background poll for Ark server updates once main app is ready
  try {
    // Initialize with current installed version and start polling
    await arkUpdateService.initialize();
  } catch (e) {}

  // Check for application updates (skip in dev mode unless --test-update flag is present)
  if (process.env.NODE_ENV !== 'development') {
    autoUpdateService.checkForUpdates().catch(console.error);
    // Re-check every 4 hours while the app is running
    autoUpdateService.startPeriodicUpdateCheck();
  } else if (process.argv.includes('--test-update')) {
    // Simulate an update lifecycle so the banner can be visually tested in dev mode
    console.log('[main] Simulating update lifecycle for dev testing...');
    setTimeout(() => {
      messagingService.sendToAllRenderers('app-update-status', { status: 'checking' });
    }, 2000);
    setTimeout(() => {
      messagingService.sendToAllRenderers('app-update-status', {
        status: 'available',
        version: '99.0.0',
        releaseNotes: 'Test release notes for dev simulation.',
        releaseDate: new Date().toISOString(),
      });
    }, 3000);
    // Simulate download progress
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      setTimeout(() => {
        messagingService.sendToAllRenderers('app-update-status', {
          status: 'downloading',
          percent: (i / steps) * 100,
          bytesPerSecond: 1024 * 1024 * 2,
          transferred: i * 5 * 1024 * 1024,
          total: steps * 5 * 1024 * 1024,
        });
      }, 3000 + i * 500);
    }
    // Simulate download complete
    setTimeout(() => {
      messagingService.sendToAllRenderers('app-update-status', {
        status: 'downloaded',
        version: '99.0.0',
        releaseNotes: 'Test release notes for dev simulation.',
        releaseDate: new Date().toISOString(),
      });
    }, 3000 + (steps + 1) * 500);
  }

});

app.on('window-all-closed', () => {
  // Cleanup automation on shutdown
  automationService.cleanup();
  
  // Cleanup RCON connections
  cleanupAllRconConnections();
  
  // Cleanup all running ARK servers
  require('./services/server-instance/server-process.service').serverProcessService.cleanupOrphanedProcesses();
  
  if (process.platform !== 'darwin' && !applicationService.isHeadless()) {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null && !applicationService.isHeadless()) {
    createWindow();
  }
});



