import * as fs from 'fs';
import * as path from 'path';
import * as pty from 'node-pty';
import axios from 'axios';
import { InstallCancelledError, InstallProgress, onInstallCancel, reportSafely } from './installer.utils';
import { getDefaultInstallDir, getPlatform } from './platform.utils';

const STEAMCMD_URLS = {
  windows: 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip',
  linux: 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz',
};

/** Download and extract share the progress bar: 0-50% download, 50-100% extract. */
const PHASE_SPLIT = 50;

const MAX_INIT_ATTEMPTS = 5;
const INIT_ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000;

export function getSteamCmdDir(): string {
  return path.join(getDefaultInstallDir(), 'steamcmd');
}

export function getSteamCmdExecutable(): string {
  return path.join(getSteamCmdDir(), getPlatform() === 'windows' ? 'steamcmd.exe' : 'steamcmd.sh');
}

export function isSteamCmdInstalled(): boolean {
  return fs.existsSync(getSteamCmdExecutable());
}

/**
 * Streams a URL to disk, reporting real byte progress. No shell is involved: no PowerShell
 * download cradle for antivirus to flag, no dependence on curl being present. Rejects with
 * InstallCancelledError when `signal` aborts.
 */
export async function downloadFile(
  url: string,
  destination: string,
  signal: AbortSignal,
  onBytes: (received: number, total: number) => void
): Promise<void> {
  const response = await axios.get(url, { responseType: 'stream', signal, maxRedirects: 5 }).catch((error: unknown) => {
    throw signal.aborted ? new InstallCancelledError() : error;
  });

  const total = Number(response.headers['content-length']) || 0;
  let received = 0;

  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(destination);
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      out.destroy();
      response.data.destroy();
      reject(err);
    };

    // An abort mid-stream must reject rather than leave a truncated archive behind that
    // the extract step would then fail on with a confusing error.
    const onAbort = () => fail(new InstallCancelledError());
    signal.addEventListener('abort', onAbort, { once: true });

    response.data.on('data', (chunk: Buffer) => {
      received += chunk.length;
      onBytes(received, total);
    });
    response.data.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      signal.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      resolve();
    });

    response.data.pipe(out);
  });
}

// `tar` and `adm-zip` are required lazily rather than imported at the top: `tar` reads
// `path.win32` during module init, which throws in any test that mocks the path module.
export async function extractTarball(archivePath: string, options: { cwd: string; strip?: number }): Promise<void> {
  const tar = require('tar');
  await tar.x({ file: archivePath, ...options });
}

/** A zip on Windows, a gzipped tar on Linux; neither spawns a process. */
async function extractArchive(archivePath: string, destination: string): Promise<void> {
  if (getPlatform() === 'windows') {
    const AdmZip = require('adm-zip');
    // adm-zip is synchronous; SteamCMD's zip is a few MB, so this is not worth a worker.
    new AdmZip(archivePath).extractAllTo(destination, true);
  } else {
    await extractTarball(archivePath, { cwd: destination });
  }
}

export function installSteamCmd(callback: (err: Error | null) => void, onProgress?: (progress: InstallProgress) => void): void {
  const dir = getSteamCmdDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const platform = getPlatform();
  const archivePath = path.join(dir, platform === 'windows' ? 'steamcmd.zip' : 'steamcmd_linux.tar.gz');
  const safeReport = reportSafely(onProgress);
  const report = (percent: number, step: string, message: string) => safeReport({ percent, step, message });

  // One signal covers the download and the first-run initialisation after it.
  const abort = new AbortController();
  const unregisterCancel = onInstallCancel(() => abort.abort());
  const finish = (err: Error | null) => {
    unregisterCancel();
    callback(err);
  };

  report(0, 'download', 'Downloading SteamCMD...');

  let lastPercent = 0;
  const run = async () => {
    await downloadFile(STEAMCMD_URLS[platform], archivePath, abort.signal, (received, total) => {
      if (!total) return;
      const percent = Math.min(Math.floor((received / total) * PHASE_SPLIT), PHASE_SPLIT);
      if (percent > lastPercent) {
        lastPercent = percent;
        report(percent, 'download', `Downloading... (${percent}%)`);
      }
    });

    report(PHASE_SPLIT, 'extract', 'Download complete. Extracting...');
    await extractArchive(archivePath, dir);
    report(100, 'complete', 'Extraction complete.');
  };

  run().then(
    () => {
      if (platform === 'linux') {
        const steamCmdSh = getSteamCmdExecutable();
        if (fs.existsSync(steamCmdSh)) {
          try {
            fs.chmodSync(steamCmdSh, '755');
          } catch (error) {
            console.warn('[steamcmd] Could not chmod steamcmd.sh:', error);
          }
        }
      }

      initializeSteamCmd(dir, safeReport, abort.signal, finish);
    },
    (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('[steamcmd] Install failed:', err.message);
      report(lastPercent, 'error', err.message);
      finish(err);
    }
  );
}

/**
 * Runs SteamCMD with +quit until it exits 0. Its first-time self-update on Windows can need
 * several restarts, and until it has finished the first real command fails. Best effort: a
 * failed or hung run never fails the install; only a cancel does.
 */
function initializeSteamCmd(
  dir: string,
  report: (progress: InstallProgress) => void,
  signal: AbortSignal,
  done: (err: Error | null) => void
): void {
  const executable = getSteamCmdExecutable();
  let attempt = 0;
  let current: pty.IPty | undefined;
  let currentTimer: NodeJS.Timeout | undefined;
  let finished = false;

  const finish = (err: Error | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(currentTimer);
    signal.removeEventListener('abort', onAbort);
    done(err);
  };
  const onAbort = () => {
    try {
      current?.kill();
    } catch (error) {
      console.warn('[steamcmd] Could not stop SteamCMD:', error);
    }
    finish(new InstallCancelledError());
  };
  signal.addEventListener('abort', onAbort, { once: true });

  const initialized = () => {
    report({ percent: 95, step: 'init', message: 'SteamCMD initialized' });
    finish(null);
  };

  const runAttempt = () => {
    if (signal.aborted) {
      finish(new InstallCancelledError());
      return;
    }
    attempt++;
    report({
      percent: Math.min(70 + attempt * 5, 95),
      step: 'init',
      message: attempt === 1
        ? 'Initializing SteamCMD (first-time setup)...'
        : `SteamCMD updating (attempt ${attempt}/${MAX_INIT_ATTEMPTS})...`
    });
    console.log(`[steamcmd] Initialization attempt ${attempt}/${MAX_INIT_ATTEMPTS}`);

    let child: pty.IPty;
    try {
      child = pty.spawn(executable, ['+quit'], { cwd: dir });
    } catch (error) {
      console.warn('[steamcmd] Could not start SteamCMD to initialize it:', error instanceof Error ? error.message : error);
      finish(null);
      return;
    }
    current = child;

    let settled = false;
    const attemptEnded = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (finished) {
        return;
      }
      if (exitCode === 0) {
        initialized();
      } else if (attempt < MAX_INIT_ATTEMPTS) {
        // SteamCMD needs another restart to finish updating
        runAttempt();
      } else {
        console.warn(`[steamcmd] Init did not reach exit code 0 after ${MAX_INIT_ATTEMPTS} attempts, proceeding anyway`);
        initialized();
      }
    };

    const timer = setTimeout(() => {
      console.warn(`[steamcmd] Init attempt ${attempt} still running after ${INIT_ATTEMPT_TIMEOUT_MS / 60000} minutes; stopping it`);
      try {
        child.kill();
      } catch (error) {
        console.warn('[steamcmd] Could not stop SteamCMD:', error);
      }
      attemptEnded(null);
    }, INIT_ATTEMPT_TIMEOUT_MS);
    currentTimer = timer;

    child.onData(() => {});
    child.onExit(({ exitCode }) => {
      console.log(`[steamcmd] Init attempt ${attempt} exited with code ${exitCode}`);
      attemptEnded(exitCode);
    });
  };

  runAttempt();
}
