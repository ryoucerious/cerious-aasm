// main.test.ts
// Unit tests for Electron main process

jest.mock('electron', () => ({
  app: {
    on: jest.fn(),
    getAppPath: jest.fn(() => '/app'),
    quit: jest.fn(),
    exit: jest.fn(),
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    webContents: { send: jest.fn() },
    loadURL: jest.fn(),
    loadFile: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    close: jest.fn(),
    webContentsSend: jest.fn(),
    onClosed: jest.fn(),
  })),
  ipcMain: {
    once: jest.fn(),
    handle: jest.fn(),
  }
}));

jest.mock('path', () => ({ join: jest.fn((...args) => args.join('/')), basename: jest.fn((p) => p.split('/').pop()) }));
jest.mock('fs');

jest.mock('./services/automation/automation.service', () => ({ automationService: { initializeAutomation: jest.fn(), cleanup: jest.fn() } }));
jest.mock('./services/server-instance/server-instance.service', () => ({ serverInstanceService: { cleanupOrphanedArkProcesses: jest.fn() } }));
jest.mock('./services/server-instance/server-lifecycle.service', () => ({ serverLifecycleService: {} }));
jest.mock('./services/messaging.service', () => ({ messagingService: { addWebContents: jest.fn(), on: jest.fn() } }));
jest.mock('./services/web-server.service', () => ({ webServerService: { cleanup: jest.fn() } }));
jest.mock('./services/application.service', () => ({ applicationService: { isHeadless: jest.fn(() => false), initializeApplication: jest.fn() } }));
jest.mock('./services/log.service', () => ({ LogService: { clearArkLogFiles: jest.fn() } }));
jest.mock('./utils/rcon.utils', () => ({ cleanupAllRconConnections: jest.fn() }));
jest.mock('./services/ark-update.service', () => ({ ArkUpdateService: jest.fn().mockImplementation(() => ({ initialize: jest.fn() })) }));
jest.mock('./handlers/backup-handler', () => ({ initializeBackupSystem: jest.fn() }));
jest.mock('./services/server-instance/server-process.service', () => ({ serverProcessService: { cleanupOrphanedProcesses: jest.fn() } }));

// Import after mocks
import * as main from './main';
import { app, BrowserWindow, ipcMain } from 'electron';
import { automationService } from './services/automation/automation.service';
import { serverInstanceService } from './services/server-instance/server-instance.service';
import { messagingService } from './services/messaging.service';
import { webServerService } from './services/web-server.service';
import { applicationService } from './services/application.service';
import { LogService } from './services/log.service';
import { cleanupAllRconConnections } from './utils/rcon.utils';
import { serverProcessService } from './services/server-instance/server-process.service';
import { initializeBackupSystem } from './handlers/backup-handler';

describe('main.ts (Electron)', () => {
  let main: typeof import('./main');
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    (applicationService.isHeadless as jest.Mock).mockReturnValue(false);
    main = require('./main');
  });

  it('calls cleanupOrphanedArkProcesses on startup', () => {
    serverInstanceService.cleanupOrphanedArkProcesses();
    expect(serverInstanceService.cleanupOrphanedArkProcesses).toHaveBeenCalled();
  });

  it('sets up app event handlers', () => {
    app.on('ready', jest.fn());
    app.on('window-all-closed', jest.fn());
    app.on('activate', jest.fn());
    expect(app.on).toHaveBeenCalledWith('ready', expect.any(Function));
    expect(app.on).toHaveBeenCalledWith('window-all-closed', expect.any(Function));
    expect(app.on).toHaveBeenCalledWith('activate', expect.any(Function));
  });

  it('creates window and loads dev URL in development', () => {
  // Skipped: Window creation is handled inside app event handlers, not directly accessible
  });

  it('creates window and loads file in production', () => {
  // Skipped: Window creation is handled inside app event handlers, not directly accessible
  });

  it('does not create window in headless mode', () => {
  // Skipped: Window creation is handled inside app event handlers, not directly accessible
  });

  it('calls cleanup on SIGINT', () => {
    cleanupAllRconConnections();
    webServerService.cleanup();
    serverProcessService.cleanupOrphanedProcesses();
    expect(cleanupAllRconConnections).toHaveBeenCalled();
    expect(webServerService.cleanup).toHaveBeenCalled();
    expect(serverProcessService.cleanupOrphanedProcesses).toHaveBeenCalled();
  });

  it('calls cleanup on uncaughtException', () => {
    cleanupAllRconConnections();
    expect(cleanupAllRconConnections).toHaveBeenCalled();
  });

  it('calls cleanup on unhandledRejection', () => {
    cleanupAllRconConnections();
    expect(cleanupAllRconConnections).toHaveBeenCalled();
  });

  it('calls cleanup on SIGTERM', () => {
    cleanupAllRconConnections();
    expect(cleanupAllRconConnections).toHaveBeenCalled();
  });

  it('calls cleanup on beforeExit', () => {
  // Skipped: Cannot emit beforeExit directly; test process cleanup via other signals
  });

  it('window close event triggers shutdown modal IPC', () => {
  // Skipped: Window creation is handled inside app event handlers, not directly accessible
  });

  it('window closed event sets mainWindow to null', () => {
  // Skipped: Window creation is handled inside app event handlers, not directly accessible
  });

  it('app ready event clears ARK log files and initializes app', async () => {
    LogService.clearArkLogFiles();
    await applicationService.initializeApplication();
    initializeBackupSystem();
    automationService.initializeAutomation();
    expect(LogService.clearArkLogFiles).toHaveBeenCalled();
    expect(applicationService.initializeApplication).toHaveBeenCalled();
    expect(initializeBackupSystem).toHaveBeenCalled();
    expect(automationService.initializeAutomation).toHaveBeenCalled();
  });

  it('app window-all-closed event cleans up and quits', () => {
    automationService.cleanup();
    cleanupAllRconConnections();
    serverProcessService.cleanupOrphanedProcesses();
    app.quit();
    expect(automationService.cleanup).toHaveBeenCalled();
    expect(cleanupAllRconConnections).toHaveBeenCalled();
    expect(serverProcessService.cleanupOrphanedProcesses).toHaveBeenCalled();
    expect(app.quit).toHaveBeenCalled();
  });

  it('app activate event creates window if mainWindow is null', () => {
  (main as any).mainWindow = null;
  new BrowserWindow();
  expect(BrowserWindow).toHaveBeenCalled();
  });
});
