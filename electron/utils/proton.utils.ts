import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InstallProgress, onInstallCancel, reportSafely } from './installer.utils';
import { getDefaultInstallDir } from './platform.utils';
import { downloadFile, extractTarball } from './steamcmd.utils';

const PROTON_RELEASE = 'GE-Proton10-15';
const PROTON_URL = `https://github.com/GloriousEggroll/proton-ge-custom/releases/download/${PROTON_RELEASE}/${PROTON_RELEASE}.tar.gz`;

/** Download and extract share the progress bar: 0-80% download, 80-100% extract. */
const PHASE_SPLIT = 80;
const STAGING_PREFIX = 'proton-staging-';

export function getProtonDir(): string {
  return path.join(getDefaultInstallDir(), 'proton');
}

/**
 * Per-instance Proton/Wine prefix directory.
 * Each ARK server must use an isolated prefix: a shared WINEPREFIX /
 * STEAM_COMPAT_DATA_PATH causes wineserver lock contention and crashes
 * when a third (or later) instance starts.
 */
export function getProtonPrefixDir(instanceId: string): string {
  if (!instanceId || typeof instanceId !== 'string') {
    throw new Error('instanceId is required for a Proton prefix directory');
  }
  return path.join(getDefaultInstallDir(), 'proton-prefix', instanceId);
}

function protonBinaryCandidates(): string[] {
  const dir = getProtonDir();
  return [path.join(dir, 'proton'), path.join(dir, 'dist', 'bin', 'proton')];
}

export function isProtonInstalled(): boolean {
  return protonBinaryCandidates().some(binary => fs.existsSync(binary));
}

export function getProtonBinaryPath(): string {
  const binary = protonBinaryCandidates().find(candidate => fs.existsSync(candidate));
  if (!binary) {
    throw new Error('Proton binary not found. Please install Proton first.');
  }
  return binary;
}

/** Shared Proton/Steam scaffolding, as opposed to the per-instance Wine prefix. */
function scaffoldingDirs(): string[] {
  const baseDir = getDefaultInstallDir();
  return [
    path.join(baseDir, '.wine-ark'),
    path.join(baseDir, '.steam-compat'),
    path.join(baseDir, '.steam'),
    path.join(os.homedir(), '.config', 'protonfixes')
  ];
}

function makeExecutable(file: string): void {
  if (!fs.existsSync(file)) return;
  try {
    fs.chmodSync(file, 0o755);
  } catch (error) {
    console.warn(`[proton] Could not make ${file} executable:`, error);
  }
}

function ensureDirs(dirs: string[]): void {
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (error) {
      console.warn(`[proton] Could not create ${dir}:`, error);
    }
  }
}

export function installProton(callback: (err: Error | null) => void, onProgress?: (progress: InstallProgress) => void): void {
  const safeReport = reportSafely(onProgress);
  const report = (percent: number, step: string, message: string) => safeReport({ percent, step, message });

  downloadAndUnpack(report).then(
    () => callback(null),
    (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('[proton] Install failed:', err.message);
      report(0, 'error', err.message);
      callback(err);
    }
  );
}

/** Staging folders an install that crashed or was killed left behind. The install lock is held. */
function removeStaleStaging(baseDir: string): void {
  for (const entry of fs.readdirSync(baseDir).filter(name => name.startsWith(STAGING_PREFIX))) {
    try {
      fs.rmSync(path.join(baseDir, entry), { recursive: true, force: true });
    } catch (error) {
      console.warn(`[proton] Could not delete ${entry}:`, error);
    }
  }
}

async function downloadAndUnpack(report: (percent: number, step: string, message: string) => void): Promise<void> {
  const baseDir = getDefaultInstallDir();
  const protonDir = getProtonDir();
  fs.mkdirSync(baseDir, { recursive: true });
  removeStaleStaging(baseDir);
  // Unpacked beside the real folder and moved in once complete: a half-unpacked Proton in place
  // would count as installed. The staging folder also holds the ~500 MB tarball, and always goes.
  const stagingDir = fs.mkdtempSync(path.join(baseDir, STAGING_PREFIX));
  const archivePath = path.join(stagingDir, `${PROTON_RELEASE}.tar.gz`);
  const unpackedDir = path.join(stagingDir, 'proton');
  const abort = new AbortController();
  const unregisterCancel = onInstallCancel(() => abort.abort());

  try {
    report(0, 'download', 'Downloading Proton...');
    let lastPercent = 0;
    await downloadFile(PROTON_URL, archivePath, abort.signal, (received, total) => {
      if (!total) return;
      const percent = Math.min(Math.floor((received / total) * PHASE_SPLIT), PHASE_SPLIT);
      if (percent > lastPercent) {
        lastPercent = percent;
        report(percent, 'download', `Downloading Proton... (${percent}%)`);
      }
    });

    report(PHASE_SPLIT, 'extract', 'Download complete. Extracting...');
    fs.mkdirSync(unpackedDir, { recursive: true });
    await extractTarball(archivePath, { cwd: unpackedDir, strip: 1 });
    fs.rmSync(protonDir, { recursive: true, force: true });
    fs.renameSync(unpackedDir, protonDir);

    makeExecutable(path.join(protonDir, 'proton'));
    ensureDirs(scaffoldingDirs());
    report(100, 'complete', 'Proton installed.');
  } finally {
    unregisterCancel();
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`[proton] Could not delete ${stagingDir}:`, error);
    }
  }
}

/**
 * Makes sure the instance's prefix exists and is writable (Proton creates pfx.lock inside it),
 * along with the shared scaffolding.
 */
export function ensureProtonPrefixExists(instanceId: string): void {
  const prefixDir = getProtonPrefixDir(instanceId);
  ensureDirs([prefixDir, ...scaffoldingDirs()]);

  try {
    fs.accessSync(prefixDir, fs.constants.W_OK | fs.constants.R_OK);
  } catch {
    console.warn(`[proton] Prefix is not writable, attempting chmod: ${prefixDir}`);
    try {
      fs.chmodSync(prefixDir, 0o700);
    } catch (error) {
      console.warn('[proton] Could not set permissions on the prefix:', error);
    }
  }
}
