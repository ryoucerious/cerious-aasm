import { spawn } from 'child_process';
import * as fs from 'fs';

/**
 * Hands the command line to the process an updater starts. The NSIS installer starts the app with
 * only --updated and the AppImage updater with nothing, so a headless install would come back as
 * a desktop window, without its port or sign-in.
 */
export const RELAUNCH_ENV = 'AASM_RELAUNCH';

/** A systemd unit with Restart=on-failure or Restart=always starts the service again after this. */
export const SERVICE_RESTART_EXIT_CODE = 75;

interface RelaunchRequest {
  /** Start the app with these arguments, then exit. */
  args?: string[];
  /** Exit at once: the process that started this one restarts the app itself. */
  exit?: boolean;
}

let beforeRestart: (() => void) | null = null;

/** main stops the servers and closes the databases here. app.exit skips its usual shutdown. */
export function setBeforeRestart(hook: (() => void) | null): void {
  beforeRestart = hook;
}

export function runBeforeRestart(): void {
  try {
    beforeRestart?.();
  } catch (error) {
    console.error('[relaunch] Shutting down before the restart failed:', error);
  }
}

/** The arguments this process was started with, as the next one needs them. */
export function launchArgs(argv: string[] = process.argv): string[] {
  return argv.slice(1).filter(arg => arg !== '--updated');
}

/** The systemd system service running this process, which restarts it, or null. */
export function systemServiceUnit(): string | null {
  if (process.platform !== 'linux') return null;
  try {
    const cgroups = fs.readFileSync('/proc/self/cgroup', 'utf8');
    return /:\/system\.slice\/(?:[^\n]*\/)?([^/\s]+\.service)\s*$/m.exec(cgroups)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** What starts this install: the AppImage, the Linux launcher beside the binary, or the executable. */
export function launchTarget(env: NodeJS.ProcessEnv = process.env, execPath = process.execPath): string {
  if (env.APPIMAGE) return env.APPIMAGE;
  // The launcher attaches xvfb-run when a headless start has no display.
  if (process.platform === 'linux' && execPath.endsWith('.bin')) {
    const launcher = execPath.slice(0, -'.bin'.length);
    if (fs.existsSync(launcher)) return launcher;
  }
  return execPath;
}

/** xvfb-run's display closes with the process it started, so the next process has to make its own. */
export function dropBorrowedDisplay(env: NodeJS.ProcessEnv): void {
  if (/xvfb-run/.test(env.XAUTHORITY || '')) {
    delete env.DISPLAY;
    delete env.XAUTHORITY;
  }
}

/** Before an installer that restarts the app: the arguments go with it. */
export function handOffLaunchArgs(args: string[] = launchArgs()): void {
  if (args.length) process.env[RELAUNCH_ENV] = JSON.stringify({ args } satisfies RelaunchRequest);
}

/** For an updater that starts the new version only to finish its install: that process exits. */
export function handOffExit(): void {
  process.env[RELAUNCH_ENV] = JSON.stringify({ exit: true } satisfies RelaunchRequest);
}

export function clearHandOff(): void {
  delete process.env[RELAUNCH_ENV];
}

/** Takes the request an updater passed on, so the processes this one starts never see it. */
export function takeRelaunchRequest(env: NodeJS.ProcessEnv = process.env): RelaunchRequest | null {
  const raw = env[RELAUNCH_ENV];
  if (!raw) return null;
  delete env[RELAUNCH_ENV];
  try {
    const request = JSON.parse(raw) as RelaunchRequest;
    if (request?.exit === true) return { exit: true };
    if (Array.isArray(request?.args) && request.args.every(arg => typeof arg === 'string')) return { args: request.args };
  } catch {
    // Not one of ours.
  }
  return null;
}

/**
 * First thing in main, in the process an updater started: exits, or starts the app again with the
 * command line it was handed. Before the single-instance lock, which this process never takes.
 */
export function resumeAfterUpdate(): void {
  const request = takeRelaunchRequest();
  if (!request) return;
  if (request.exit) process.exit(0);
  const env = { ...process.env };
  dropBorrowedDisplay(env);
  console.log('[relaunch] Starting the updated app with its command line');
  spawn(launchTarget(), request.args ?? [], { detached: true, stdio: 'ignore', env }).unref();
  process.exit(0);
}

/** Exits after starting an installer that starts the app again itself. */
export function exitForInstaller(): void {
  const { app } = require('electron') as typeof import('electron');
  runBeforeRestart();
  app.exit(0);
}

/**
 * Starts the app again with the same command line once this process has exited, then exits.
 * Under a systemd service, exits for systemd to restart it: a process started here would be in
 * the unit's cgroup and stopped with it.
 */
export function restartApp(target: string = launchTarget()): void {
  const { app } = require('electron') as typeof import('electron');
  runBeforeRestart();
  const unit = systemServiceUnit();
  if (unit) {
    console.log(`[relaunch] Exiting for systemd to restart ${unit}`);
    app.exit(SERVICE_RESTART_EXIT_CODE);
    return;
  }
  clearHandOff();
  dropBorrowedDisplay(process.env);
  console.log('[relaunch] Restarting the app');
  app.relaunch({ execPath: target, args: launchArgs() });
  app.exit(0);
}
