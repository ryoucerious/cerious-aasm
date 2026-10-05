import { execFile } from 'child_process';
import { getPlatform } from '../../platform.utils';
import { getInstallProcessMarker, getInstanceProcessMarker } from './ark-server-paths.utils';

const ARK_EXECUTABLES = ['ArkAscendedServer.exe', 'AsaApiLoader.exe'];
const SWEEP_TIMEOUT_MS = 15000;
// The -like pattern travels in this environment variable, so the script holds no user text and
// nothing in a path (quotes, typographic quotes included) can break out of a string literal.
const PATTERN_VARIABLE = 'AASM_PROCESS_PATTERN';
const STOP_PROCESSES_SCRIPT =
  `Get-CimInstance Win32_Process | Where-Object { $_.Name -in @(${ARK_EXECUTABLES.map(name => `'${name}'`).join(',')}) ` +
  `-and $_.CommandLine -like $env:${PATTERN_VARIABLE} } | ` +
  'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';

// A sweep still running when an instance's next process spawns would match, and kill, the new run,
// so starts wait for this work (see waitForProcessSweeps). Keyed by instance id; the install-wide
// sweep has a key of its own.
const INSTALL = Symbol('install');
const pendingWork = new Map<string | typeof INSTALL, Promise<void>>();

// Installing or removing AsaApi switches an instance between isolated and shared, and the marker
// with it; processes still running carry the one they were launched with.
const launchMarkers = new Map<string, string>();

/**
 * Stops the server processes an earlier run of this app left behind: those launched from its own
 * install. ARK servers run by anything else on the host are left alone. Never rejects.
 */
export function cleanupOrphanedArkProcesses(): Promise<void> {
  let marker: string;
  try {
    marker = getInstallProcessMarker();
  } catch (error) {
    console.warn('[ark-server-cleanup] Not looking for leftover servers:', error instanceof Error ? error.message : error);
    return Promise.resolve();
  }
  return enqueue(INSTALL, () => killArkProcessesMatching(marker), 'The leftover server sweep');
}

/** For a spawn: the marker its processes carry, which later sweeps of the instance go by. */
export function rememberInstanceProcessMarker(instanceId: string): void {
  try {
    launchMarkers.set(instanceId, getInstanceProcessMarker(instanceId));
  } catch {
    launchMarkers.delete(instanceId);
  }
}

/**
 * Stops whatever is left of one instance's server (Wine, ARK, AsaApiLoader) after its tracked
 * launcher exited, so its ports are free again. Runs after the instance's earlier sweeps. Never rejects.
 */
export function killInstanceProcesses(instanceId: string): Promise<void> {
  let marker: string;
  try {
    marker = launchMarkers.get(instanceId) ?? getInstanceProcessMarker(instanceId);
  } catch (error) {
    console.warn(`[ark-server-cleanup] Not looking for leftovers of ${instanceId}:`, error instanceof Error ? error.message : error);
    return Promise.resolve();
  }
  return enqueue(instanceId, () => killArkProcessesMatching(marker), `Cleaning up after ${instanceId}`);
}

/**
 * Makes the next start of `instanceId` wait for `teardown` too: work still ending its previous run
 * that must not overlap the next one. A failed teardown is logged. Never rejects.
 */
export function holdStartsUntil(instanceId: string, teardown: Promise<unknown>): Promise<void> {
  return enqueue(instanceId, () => teardown, `Cleaning up after ${instanceId}`);
}

/** Resolves once no sweep or teardown that could touch `instanceId`'s next run is still going. */
export async function waitForProcessSweeps(instanceId: string): Promise<void> {
  await pendingWork.get(INSTALL);
  await pendingWork.get(instanceId);
}

// Chained, never replaced, so a start waits for everything registered before it. Nothing queued
// here rejects: a start awaits it, and one that rejected would fail every later start. With nothing
// pending the work begins at once (app exit relies on pkill being spawned before it returns).
function enqueue(key: string | typeof INSTALL, next: () => Promise<unknown>, what: string): Promise<void> {
  const previous = pendingWork.get(key);
  const work = (previous ? previous.then(next) : next()).then(
    () => undefined,
    error => console.warn(`[ark-server-cleanup] ${what} failed:`, error instanceof Error ? error.message : error)
  );
  pendingWork.set(key, work);
  void work.then(() => {
    if (pendingWork.get(key) === work) pendingWork.delete(key);
  });
  return work;
}

// The marker is matched literally and never passes through a shell.
function killArkProcessesMatching(marker: string): Promise<void> {
  return new Promise(resolve => {
    const windows = getPlatform() === 'windows';
    const done = (error: (Error & { code?: unknown }) | null) => {
      // pkill exits 1 when nothing matched; for PowerShell any failure is one.
      const nothingMatched = !windows && error?.code === 1;
      if (error && !nothingMatched) {
        console.warn('[ark-server-cleanup] Could not stop leftover server processes:', error.message);
      }
      resolve();
    };
    // execFile throws, rather than calling back, for arguments it cannot pass on.
    try {
      if (windows) {
        const pattern = `*${marker.replace(/[`*?[\]]/g, '`$&')}*`;
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', STOP_PROCESSES_SCRIPT],
          { windowsHide: true, timeout: SWEEP_TIMEOUT_MS, env: { ...process.env, [PATTERN_VARIABLE]: pattern } },
          done
        );
      } else {
        execFile('pkill', ['-f', escapeRegExp(marker)], { windowsHide: true, timeout: SWEEP_TIMEOUT_MS }, done);
      }
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
