// --- Imports ---
import * as path from 'path';
import * as fs from 'fs';
import { getSteamCmdDir } from '../steamcmd.utils';
import { runInstaller } from '../installer.utils';
import { ArkPathUtils, ARK_APP_ID } from './ark-path.utils';
import { getPlatform } from '../platform.utils';

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

/**
 * A failed update leaves UpdateResult 6 ("no connection") in the app manifest.
 * SteamCMD then keeps requesting that old manifest, which the CDN rejects with
 * Access Denied, and every retry dies in a few seconds. Removing the manifest
 * lets the next run fetch the current public build. Installed files stay put.
 */
function clearStuckArkManifest(installDir: string): void {
  const manifestPath = path.join(installDir, 'steamapps', `appmanifest_${ARK_APP_ID}.acf`);
  if (!fs.existsSync(manifestPath)) return;
  let content = '';
  try {
    content = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    return;
  }
  if (!/"UpdateResult"\s+"6"/.test(content)) return;
  try {
    fs.unlinkSync(manifestPath);
    console.warn('[ark-install] Removed stuck Steam appmanifest so the server download can start again.');
  } catch (error) {
    console.warn('[ark-install] Could not remove stuck Steam appmanifest:', error);
  }
}

// --- Installation Utilities ---

/**
 * Get the ARK server installation directory
 */
export function getArkServerDir(): string {
  return ArkPathUtils.getArkServerDir();
}

/**
 * Check if ARK server is installed
 */
export function isArkServerInstalled(): boolean {
  const arkExecutable = ArkPathUtils.getArkExecutablePath();
  return fs.existsSync(arkExecutable);
}

/**
 * Get current installed ARK server version
 */
export async function getCurrentInstalledVersion(): Promise<string | null> {
  try {
    const serverPath = getArkServerDir();
    const versionFile = path.join(serverPath, 'version.txt');
    if (fs.existsSync(versionFile)) {
      const version = fs.readFileSync(versionFile, 'utf8').trim();
      if (version) return version;
    }
    const steamappsPath = path.join(serverPath, 'steamapps');
    if (fs.existsSync(steamappsPath)) {
      const manifestPath = path.join(steamappsPath, `appmanifest_${ARK_APP_ID}.acf`);
      if (fs.existsSync(manifestPath)) {
        const manifestContent = fs.readFileSync(manifestPath, 'utf8');
        const buildIdMatch = manifestContent.match(/"buildid"\s+"(\d+)"/);
        if (buildIdMatch) {
          return buildIdMatch[1];
        }
      }
    }
    return null;
  } catch (error) {
    console.error('[ark.utils] Error getting current version:', error);
    return null;
  }
}

/**
 * Install ARK server using SteamCMD
 */
export function installArkServer(
  callback: (err: Error | null, output?: string) => void,
  onData?: (data: any) => void
): void {
  const steamcmdPath = getSteamCmdDir();
  const steamcmdExe = process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd.sh';
  const steamcmdExecutable = path.join(steamcmdPath, steamcmdExe);
  if (!fs.existsSync(steamcmdExecutable)) {
    const error = new Error('SteamCMD not found. Please install SteamCMD first.');
    callback(error);
    return;
  }
  const installDir = getArkServerDir();
  let arkProgressState = { maxBootstrap: 0, largeDownloadStarted: false };
  const installerOptions = {
    command: steamcmdExecutable,
    args: arkUpdateArgs(installDir),
    cwd: steamcmdPath,
    estimatedTotal: 100,
    phaseSplit: 80,
    parseProgress: (data: string, lastPercent: number) => {
      const steamcmdPatterns = [
        /Update state.*?progress: (\d+\.\d+)/i,
        /\[\s*(\d+)%\]\s+Downloading update/i,
        /\[\s*(\d+)%\]\s+Download complete/i,
        /progress: (\d+\.\d+)/i,
        /(\d+)% complete/i,
        /downloading.*?(\d+)%/i,
      ];
      for (const pattern of steamcmdPatterns) {
        const match = pattern.exec(data);
        if (match) {
          let percent = parseFloat(match[1]);
          if (percent > 100) percent = 100;
          if (data.includes('Update state (0x61) downloading')) {
            if (!arkProgressState.largeDownloadStarted) {
              arkProgressState.largeDownloadStarted = true;
              if (onData) {
                onData({
                  percent: 0,
                  step: 'downloading',
                  message: 'Starting Ark Server download...'
                });
              }
            }
            if (percent >= lastPercent) {
              if (onData) {
                onData({
                  percent: Math.floor(percent),
                  step: 'downloading',
                  message: `Downloading Ark Server (${percent.toFixed(1)}%)`
                });
              }
              return Math.floor(percent);
            } else {
              return null;
            }
          } else if (data.includes('Update state (0x81) verifying')) {
            if (onData) {
              onData({
                percent: 100,
                step: 'downloading',
                message: `Verifying Ark Server installation...`
              });
            }
            return 100;
          } else {
            return null;
          }
        }
      }
      return null;
    },
    validatePhase: () => ({
      command: steamcmdExecutable,
      args: arkUpdateArgs(installDir),
      cwd: steamcmdPath,
    })
  };
  const MAX_RETRIES = 2;
  let attempts = 0;

  function attemptInstall() {
    attempts++;
    clearStuckArkManifest(installDir);
    // Reset progress state for retries so progress reporting works correctly
    if (attempts > 1) {
      arkProgressState = { maxBootstrap: 0, largeDownloadStarted: false };
      console.log(`[ark-install] Retrying SteamCMD install (attempt ${attempts}/${MAX_RETRIES + 1})...`);
      if (onData) {
        onData({
          percent: 0,
          step: 'download',
          message: `Retrying ARK server install (attempt ${attempts})...`
        });
      }
    }

    runInstaller(
      installerOptions,
      (progress) => {
        if (onData) {
          onData(progress);
        }
      },
      (err, output) => {
        if (err && attempts <= MAX_RETRIES) {
          // SteamCMD may exit non-zero during self-update; retry automatically
          console.warn(`[ark-install] Attempt ${attempts} failed: ${err.message}`);
          attemptInstall();
        } else {
          callback(err ?? null, output);
        }
      }
    );
  }

  attemptInstall();
}