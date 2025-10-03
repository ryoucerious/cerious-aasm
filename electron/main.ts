// =========================
// Command Line Arguments & Sandbox Configuration
// MUST BE FIRST - Before any Electron imports!
// =========================
// Check if running in headless mode or if we need to disable sandbox
const isHeadlessMode = process.argv.includes('--headless');
const isLinux = process.platform === 'linux';

// =========================
// Core Dependencies
// =========================
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// Apply sandbox fixes immediately after app import
if (isLinux || isHeadlessMode) {
  app.commandLine.appendSwitch('--no-sandbox');
  app.commandLine.appendSwitch('--disable-setuid-sandbox');
}

// Additional stability switches for headless mode
if (isHeadlessMode) {
  app.commandLine.appendSwitch('--disable-gpu');
  app.commandLine.appendSwitch('--disable-software-rasterizer');
  app.commandLine.appendSwitch('--disable-dev-shm-usage');
}

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
import { initializeBackupSystem } from './handlers/backup-handler';

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

// =========================
// Service Initialization
// =========================
const arkUpdateService = new ArkUpdateService(messagingService);


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
  console.error('[main] Unhandled promise rejection at:', promise, 'reason:', reason);
  cleanup();
  process.exit(1);
});

// =========================
// Process Cleanup
// =========================
const cleanup = () => {
  // Cleanup RCON connections first
  cleanupAllRconConnections();

  // Cleanup web server
  webServerService.cleanup();

  // Then cleanup ARK server processes
  require('./services/server-instance/server-process.service').serverProcessService.cleanupOrphanedProcesses();
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
function createWindow() {
  if (applicationService.isHeadless()) {
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    autoHideMenuBar: true, // Hide the menu bar
    icon: path.join(__dirname, '..', 'logo.png'), // Set app icon
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  messagingService.addWebContents(mainWindow.webContents);
  
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
          setTimeout(() => app.exit(0), 1500);
        } else if (data && data.action === 'exit') {
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
  // Clear ARK log files before starting servers
  LogService.clearArkLogFiles();

  // Initialize application (handles headless mode and web server startup)
  await applicationService.initializeApplication();

  createWindow();
  // Initialize backup system
  initializeBackupSystem().catch(console.error);
  // Initialize automation system
  automationService.initializeAutomation();

  // Start background poll for Ark server updates once main app is ready
  try {
    // Initialize with current installed version and start polling
    await arkUpdateService.initialize();
  } catch (e) {}

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



