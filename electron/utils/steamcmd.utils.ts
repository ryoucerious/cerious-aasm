import * as fs from 'fs';
import * as path from 'path';
import * as pty from 'node-pty';
import axios from 'axios';
import * as crypto from 'crypto';
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
  if (!fs.existsSync(getSteamCmdExecutable())) return false;
  // An install whose first-time update failed has steamcmd.sh but can't download anything;
  // report it missing so the installer runs again and repairs it.
  return getPlatform() !== 'linux' || isLinuxSteamCmdBootstrapped(getSteamCmdDir());
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

      initializeSteamCmd(dir, safeReport, abort.signal, err => {
        if (err || platform !== 'linux' || isLinuxSteamCmdBootstrapped(dir)) {
          finish(err);
          return;
        }

        // The bootstrapper's own update host is gone (see LINUX_PACKAGE_HOSTS), so it left no
        // usable client behind. Fetch the current packages and let the new steamcmd.sh finish
        // its first start.
        console.warn('[steamcmd] First-time update did not complete; installing the SteamCMD packages directly.');
        report(95, 'init', 'Downloading SteamCMD update...');
        installLinuxPackages(dir, abort.signal).then(
          () => initializeSteamCmd(dir, safeReport, abort.signal, finish),
          (error: unknown) => {
            if (error instanceof InstallCancelledError) {
              finish(error);
              return;
            }
            const message = `SteamCMD could not finish its first-time update: ${error instanceof Error ? error.message : String(error)}`;
            console.error('[steamcmd]', message);
            report(95, 'error', message);
            finish(new Error(message));
          }
        );
      });
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
 * steamcmd_linux.tar.gz holds a bootstrapper from 2018 that takes its first update only from
 * client-download.steampowered.com. When that host doesn't resolve, the bootstrap exits 1 in
 * under a second and SteamCMD never becomes usable. The current packages are still published on
 * the host the updated client uses, so install them from there.
 */
const LINUX_PACKAGE_HOSTS = [
  'https://client-update.steamstatic.com',
  'https://media.steampowered.com/client',
];

/** The bootstrapper ships without steamclient.so; the first update adds it. */
function isLinuxSteamCmdBootstrapped(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'linux32', 'steamclient.so'));
}

/** The "file" and "sha2" of each package block in a steam_cmd_linux manifest. */
function parsePackageManifest(text: string): { file: string; sha2: string }[] {
  const packages: { file: string; sha2: string }[] = [];
  // Package blocks are the innermost braces; the outer "linux" block wraps them.
  for (const block of text.match(/\{[^{}]*\}/g) ?? []) {
    const file = /"file"\s+"([^"]+)"/.exec(block)?.[1];
    const sha2 = /"sha2"\s+"([0-9a-f]{64})"/i.exec(block)?.[1];
    if (file && sha2) {
      packages.push({ file, sha2: sha2.toLowerCase() });
    }
  }
  return packages;
}

/** Rejects with InstallCancelledError when `signal` aborts, like downloadFile. */
async function installLinuxPackagesFrom(host: string, dir: string, signal: AbortSignal): Promise<void> {
  const manifest = await axios.get(`${host}/steam_cmd_linux`, { responseType: 'text', signal }).catch((error: unknown) => {
    throw signal.aborted ? new InstallCancelledError() : error;
  });
  const packages = parsePackageManifest(String(manifest.data));
  if (packages.length === 0) {
    throw new Error(`no packages listed in ${host}/steam_cmd_linux`);
  }

  const packageDir = path.join(dir, 'package');
  fs.mkdirSync(packageDir, { recursive: true });
  for (const { file, sha2 } of packages) {
    const zipPath = path.join(packageDir, file);
    await downloadFile(`${host}/${file}`, zipPath, signal, () => {});
    const actual = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
    if (actual !== sha2) {
      throw new Error(`checksum mismatch for ${file}`);
    }
    const AdmZip = require('adm-zip');
    new AdmZip(zipPath).extractAllTo(dir, true);
  }

  // The zips store DOS attributes, so nothing comes out executable.
  const executables = [path.join(dir, 'steamcmd.sh')];
  for (const platformDir of ['linux32', 'linux64']) {
    try {
      for (const name of fs.readdirSync(path.join(dir, platformDir)) ?? []) {
        executables.push(path.join(dir, platformDir, name));
      }
    } catch {
      // A package set without this platform is fine.
    }
  }
  for (const file of executables) {
    try {
      fs.chmodSync(file, 0o755);
    } catch (error) {
      console.warn(`[steamcmd] Could not chmod ${file}:`, error);
    }
  }
}

/** Tries each host in turn; a cancel stops at once. */
async function installLinuxPackages(dir: string, signal: AbortSignal): Promise<void> {
  let lastError: unknown;
  for (const host of LINUX_PACKAGE_HOSTS) {
    try {
      await installLinuxPackagesFrom(host, dir, signal);
      return;
    } catch (error) {
      if (error instanceof InstallCancelledError || signal.aborted) throw new InstallCancelledError();
      lastError = error;
      console.warn(`[steamcmd] Could not install packages from ${host}:`, error instanceof Error ? error.message : error);
    }
  }
  throw lastError;
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
