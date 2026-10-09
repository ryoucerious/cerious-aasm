import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { isRunningInDocker } from '../utils/platform.utils';

/** Whether this install can start with the computer, and whether it is set to. */
export interface RunAtStartup {
  supported: boolean;
  enabled: boolean;
}

interface StartupOptions {
  /** Running without a window, as a service does: there is nothing for a login to open. */
  headless?: boolean;
}

const UNSUPPORTED: RunAtStartup = { supported: false, enabled: false };

/**
 * Starting the app when someone logs in to the computer: Windows' own startup list, or an XDG
 * autostart entry on Linux, which desktop sessions run at login. Not in Docker, where the
 * container starts the app, and not without a window to open.
 */
export function runAtStartupStatus(options: StartupOptions = {}): RunAtStartup {
  if (!supported(options)) return UNSUPPORTED;
  if (process.platform === 'win32') {
    const launch = launchCommand();
    return { supported: true, enabled: app.getLoginItemSettings({ path: launch.path, args: launch.args }).openAtLogin };
  }
  return { supported: true, enabled: fs.existsSync(autostartEntry()) };
}

export function setRunAtStartup(enabled: boolean, options: StartupOptions = {}): RunAtStartup {
  if (!supported(options)) return UNSUPPORTED;
  if (process.platform === 'win32') {
    const launch = launchCommand();
    app.setLoginItemSettings({ openAtLogin: enabled, path: launch.path, args: launch.args });
  } else if (enabled) {
    fs.mkdirSync(path.dirname(autostartEntry()), { recursive: true });
    fs.writeFileSync(autostartEntry(), desktopEntry());
  } else {
    fs.rmSync(autostartEntry(), { force: true });
  }
  return runAtStartupStatus(options);
}

function supported(options: StartupOptions): boolean {
  return (process.platform === 'win32' || process.platform === 'linux') && !options.headless && !isRunningInDocker();
}

/**
 * What starts this app: an AppImage from its own file, not the copy it unpacks on each run; an
 * installed app from its executable; run from source, Electron with the app's folder.
 */
function launchCommand(): { path: string; args: string[] } {
  if (process.env.APPIMAGE) return { path: process.env.APPIMAGE, args: [] };
  return { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] };
}

function autostartEntry(): string {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'autostart', 'cerious-aasm.desktop');
}

function desktopEntry(): string {
  const launch = launchCommand();
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Cerious AASM',
    'Comment=ARK Ascended Server Manager',
    `Exec=${[launch.path, ...launch.args].map(quoteArgument).join(' ')}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n');
}

/** Quoted as the Desktop Entry spec asks, so a path with spaces stays one argument. */
function quoteArgument(value: string): string {
  return `"${value.replace(/(["`$\\])/g, '\\$1')}"`;
}
