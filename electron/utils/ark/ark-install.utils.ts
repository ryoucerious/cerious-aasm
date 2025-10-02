// --- Imports ---
import * as path from 'path';
import * as fs from 'fs';
import { getSteamCmdDir } from '../steamcmd.utils';
import { runInstaller } from '../installer.utils';
import { ArkPathUtils, ARK_APP_ID } from './ark-path.utils';

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
    args: [
      '+force_install_dir', installDir,
      '+login', 'anonymous',
      '+app_update', ARK_APP_ID, 'validate',
      '+quit'
    ],
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
      args: [
        '+force_install_dir', `"${installDir}"`,
        '+login', 'anonymous',
        '+app_update', ARK_APP_ID, 'validate',
        '+quit'
      ],
      cwd: steamcmdPath,
    })
  };
  runInstaller(
    installerOptions,
    (progress) => {
      if (onData) {
        onData(progress);
      }
    },
    (err, output) => {
      callback(err, output);
    }
  );
}