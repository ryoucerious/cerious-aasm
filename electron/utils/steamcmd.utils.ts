
import * as path from 'path';
import * as pty from 'node-pty';
import axios from 'axios';
import { getDefaultInstallDir } from './platform.utils';
import { setCurrentAbort } from './installer.utils';
import * as fs from 'fs';



export function getSteamCmdDir() {
  return path.join(getDefaultInstallDir(), 'steamcmd');
}


export function isSteamCmdInstalled(): boolean {
  const dir = getSteamCmdDir();
  if (process.platform === 'win32') {
    return fs.existsSync(path.join(dir, 'steamcmd.exe'));
  } else {
    return fs.existsSync(path.join(dir, 'steamcmd.sh'));
  }
}

const STEAMCMD_URLS = {
  win32: 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip',
  linux: 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz',
};

/** Download and extract share the progress bar: 0-50% download, 50-100% extract. */
const PHASE_SPLIT = 50;

/**
 * Stream a URL to disk, reporting real byte progress.
 *
 * This used to shell out — `powershell.exe -Command Invoke-WebRequest` on Windows and
 * `bash -c curl` on Linux — and scrape percentages out of a pty. Streaming it here means
 * no shell at all: no PowerShell download cradle for antivirus to flag, no dependence on
 * curl/tar being present, and Content-Length gives exact progress instead of the 5 MB
 * guess the old Windows path divided by.
 */
async function downloadFile(
  url: string,
  destination: string,
  signal: AbortSignal,
  onBytes: (received: number, total: number) => void
): Promise<void> {
  const response = await axios.get(url, {
    responseType: 'stream',
    signal,
    maxRedirects: 5,
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
    const onAbort = () => fail(new Error('Install cancelled.'));
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

/**
 * Unpack the SteamCMD archive. The format differs by platform — a zip on Windows, a
 * gzipped tar on Linux — so the two branches are inherent, but neither spawns a process.
 */
async function extractArchive(archivePath: string, destination: string): Promise<void> {
  // Both libraries are required lazily rather than imported at the top: `tar` reads
  // `path.win32` during module init, which throws in any test that mocks the path module,
  // and each platform only ever needs one of the two.
  if (process.platform === 'win32') {
    const AdmZip = require('adm-zip');
    // adm-zip is synchronous; SteamCMD's zip is a few MB, so this is not worth a worker.
    new AdmZip(archivePath).extractAllTo(destination, true);
  } else {
    const tar = require('tar');
    await tar.x({ file: archivePath, cwd: destination });
  }
}

export function installSteamCmd(callback: (err: Error | null, output?: string) => void, onData?: (data: any) => void) {
  const dir = getSteamCmdDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const isWindows = process.platform === 'win32';
  const url = isWindows ? STEAMCMD_URLS.win32 : STEAMCMD_URLS.linux;
  const archivePath = path.join(dir, isWindows ? 'steamcmd.zip' : 'steamcmd_linux.tar.gz');

  const report = (percent: number, step: string, message: string) => {
    if (onData) {
      onData({ percent, step, message });
    }
  };

  // Registered so the existing Cancel button (cancelInstaller) can stop the download.
  const abort = new AbortController();
  setCurrentAbort(abort);

  report(0, 'download', 'Downloading SteamCMD...');

  let lastPercent = 0;
  const run = async () => {
    await downloadFile(url, archivePath, abort.signal, (received, total) => {
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
      setCurrentAbort(null);

      // On Linux, ensure steamcmd.sh is executable after extraction
      if (process.platform !== 'win32') {
        const steamcmdSh = path.join(dir, 'steamcmd.sh');
        if (fs.existsSync(steamcmdSh)) {
          try { fs.chmodSync(steamcmdSh, '755'); } catch (e) {
            console.warn('[steamcmd] Could not chmod steamcmd.sh:', e);
          }
        }
      }

      // SteamCMD must self-update on first run before it can process commands.
      // Run it once with +quit to complete the self-update.
      initializeSteamCmd(dir, onData, () => {
        callback(null, 'SteamCMD installed');
      });
    },
    (err: any) => {
      setCurrentAbort(null);
      const message = err?.message || String(err);
      console.error('[steamcmd] Install failed:', message);
      report(lastPercent, 'error', message);
      callback(err instanceof Error ? err : new Error(message));
    }
  );
}

const MAX_INIT_ATTEMPTS = 5;

/**
 * Run SteamCMD with +quit repeatedly until it exits with code 0.
 * SteamCMD's first-time self-update on Windows can require multiple restarts
 * before it fully completes. Without this, the first real command fails.
 */
function initializeSteamCmd(
  dir: string,
  onData: ((data: any) => void) | undefined,
  done: () => void
) {
  const exe = process.platform === 'win32'
    ? path.join(dir, 'steamcmd.exe')
    : path.join(dir, 'steamcmd.sh');

  let attempt = 0;

  function runAttempt() {
    attempt++;
    const pct = Math.min(70 + attempt * 5, 95);
    if (onData) {
      onData({
        percent: pct,
        step: 'init',
        message: attempt === 1
          ? 'Initializing SteamCMD (first-time setup)...'
          : `SteamCMD updating (attempt ${attempt}/${MAX_INIT_ATTEMPTS})...`
      });
    }
    console.log(`[steamcmd] Initialization attempt ${attempt}/${MAX_INIT_ATTEMPTS}`);

    let proc: pty.IPty;
    try {
      proc = pty.spawn(exe, ['+quit'], { cwd: dir });
    } catch (spawnErr: any) {
      console.warn('[steamcmd] Failed to spawn during init:', spawnErr.message);
      done();
      return;
    }

    proc.onData(() => {});

    proc.onExit((result) => {
      console.log(`[steamcmd] Init attempt ${attempt} exited with code ${result.exitCode}`);
      if (result.exitCode === 0) {
        if (onData) {
          onData({ percent: 95, step: 'init', message: 'SteamCMD initialized' });
        }
        done();
      } else if (attempt < MAX_INIT_ATTEMPTS) {
        // SteamCMD needs another restart to finish updating
        runAttempt();
      } else {
        console.warn(`[steamcmd] Init did not reach exit code 0 after ${MAX_INIT_ATTEMPTS} attempts, proceeding anyway`);
        if (onData) {
          onData({ percent: 95, step: 'init', message: 'SteamCMD initialized' });
        }
        done();
      }
    });
  }

  runAttempt();
}

// Inline exports are used above
