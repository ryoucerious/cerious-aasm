import * as fs from 'fs';
import * as path from 'path';
import { InstallCancelledError, InstallProgress, reportSafely, runInstaller } from '../installer.utils';
import { getPlatform } from '../platform.utils';
import { getSteamCmdDir, getSteamCmdExecutable } from '../steamcmd.utils';
import { ARK_APP_ID, getArkExecutablePath, getArkServerDir } from './ark-server/ark-server-paths.utils';

const MAX_RETRIES = 2;
// SteamCMD prints a progress line every few seconds while it works, so this much silence is a hang.
const STALL_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * ASA's dedicated server depot is Windows-only. On Linux, SteamCMD must request
 * that depot before login or the anonymous session is denied a manifest code.
 */
function arkUpdateArgs(installDir: string): string[] {
  const args = [
    '+force_install_dir', installDir,
    '+login', 'anonymous',
    '+app_update', ARK_APP_ID, 'validate',
    '+quit',
  ];
  if (getPlatform() === 'linux') {
    args.unshift('+@sSteamCmdForcePlatformType', 'windows');
  }
  return args;
}

function manifestPath(installDir: string): string {
  return path.join(installDir, 'steamapps', `appmanifest_${ARK_APP_ID}.acf`);
}

/**
 * A failed update leaves UpdateResult 6 ("no connection") in the app manifest.
 * SteamCMD then keeps requesting that old manifest, which the CDN rejects with
 * Access Denied, and every retry dies in a few seconds. Removing the manifest
 * lets the next run fetch the current public build. Installed files stay put.
 */
function clearStuckArkManifest(installDir: string): void {
  const manifest = manifestPath(installDir);
  if (!fs.existsSync(manifest)) return;
  let content: string;
  try {
    content = fs.readFileSync(manifest, 'utf8');
  } catch {
    return;
  }
  if (!/"UpdateResult"\s+"6"/.test(content)) return;
  try {
    fs.unlinkSync(manifest);
    console.warn('[ark-install] Removed stuck Steam appmanifest so the server download can start again.');
  } catch (error) {
    console.warn('[ark-install] Could not remove stuck Steam appmanifest:', error);
  }
}

function parseSteamCmdProgress(chunk: string): InstallProgress | null {
  if (chunk.includes('Update state (0x61) downloading')) {
    const match = /progress: (\d+(?:\.\d+)?)/i.exec(chunk);
    if (!match) return null;
    const percent = Math.min(parseFloat(match[1]), 100);
    return { percent: Math.floor(percent), step: 'downloading', message: `Downloading Ark Server (${percent.toFixed(1)}%)` };
  }
  if (chunk.includes('Update state (0x81) verifying')) {
    return { percent: 100, step: 'downloading', message: 'Verifying Ark Server installation...' };
  }
  return null;
}

export function isArkServerInstalled(): boolean {
  return fs.existsSync(getArkExecutablePath());
}

/**
 * The installed build: the manifest's build id, else version.txt. The build id comes first
 * because it is what Steam reports. Read from the install under the Server Data Directory: with
 * the default dir the manifest was never found and an update always looked pending. An update
 * reads the copy it downloaded into by passing its folder.
 */
export async function getCurrentInstalledVersion(serverDir: string = getArkServerDir()): Promise<string | null> {
  try {
    const manifest = manifestPath(serverDir);
    if (fs.existsSync(manifest)) {
      const buildId = /"buildid"\s+"(\d+)"/.exec(fs.readFileSync(manifest, 'utf8'))?.[1];
      if (buildId) return buildId;
    }

    const versionFile = path.join(serverDir, 'version.txt');
    if (fs.existsSync(versionFile)) {
      const version = fs.readFileSync(versionFile, 'utf8').trim();
      if (version) return version;
    }
    return null;
  } catch (error) {
    console.error('[ark-install] Could not read the installed version:', error);
    return null;
  }
}

/**
 * Installs or updates the shared ARK server with SteamCMD, or the copy of it in `installDir` that
 * an update downloads into while the servers run. The caller holds the install lock. Aborting
 * `signal` stops the running attempt and ends the install without another retry.
 */
export function installArkServer(
  callback: (err: Error | null) => void,
  onProgress?: (progress: InstallProgress) => void,
  signal?: AbortSignal,
  installDir: string = getArkServerDir()
): void {
  const steamCmd = getSteamCmdExecutable();
  if (!fs.existsSync(steamCmd)) {
    callback(new Error('SteamCMD not found. Please install SteamCMD first.'));
    return;
  }
  const report = reportSafely(onProgress);
  let attempt = 0;

  const tryInstall = () => {
    attempt++;
    clearStuckArkManifest(installDir);
    if (attempt === 1) {
      report({ percent: 0, step: 'download', message: 'Checking Ark Server...' });
    } else {
      console.log(`[ark-install] Retrying SteamCMD install (attempt ${attempt}/${MAX_RETRIES + 1})`);
      report({ percent: 0, step: 'download', message: `Retrying ARK server install (attempt ${attempt})...` });
    }

    runInstaller(
      {
        command: steamCmd,
        args: arkUpdateArgs(installDir),
        cwd: getSteamCmdDir(),
        parseProgress: parseSteamCmdProgress,
        stallTimeoutMs: STALL_TIMEOUT_MS,
        signal
      },
      report,
      err => {
        // SteamCMD may exit non-zero during self-update; retry automatically. A cancel is final.
        if (err && !(err instanceof InstallCancelledError) && !signal?.aborted && attempt <= MAX_RETRIES) {
          console.warn(`[ark-install] Attempt ${attempt} failed: ${err.message}`);
          tryInstall();
          return;
        }
        callback(err);
      }
    );
  };

  tryInstall();
}
