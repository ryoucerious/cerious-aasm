import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { runInstaller } from '../../installer.utils';
import { getDefaultInstallDir } from '../../platform.utils';
import { getSteamCmdDir, isSteamCmdInstalled } from '../../steamcmd.utils';

// --- Constants ---
const ARK_APP_ID = '2430930';
const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let lastKnownBuildId: string | null = null;

// --- Utility Functions ---
export function getArkServerDir(): string {
  return path.join(getDefaultInstallDir(), 'AASMServer');
}

export function isArkServerInstalled(): boolean {
  const arkExecutable = path.join(getArkServerDir(), 'ShooterGame', 'Binaries', 'Win64', 'ArkAscendedServer.exe');
  return fs.existsSync(arkExecutable);
}

// --- Version Logic ---
export async function getCurrentInstalledVersion(): Promise<string | null> {
  try {
    const serverPath = getArkServerDir();
    
    // Priority: AppManifest (Build ID) > version.txt (Display Version)
    // We prioritize Build ID because that's what we compare against SteamCMD for updates.
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

    // Fallback to version.txt if manifest not found (legacy or corrupted install)
    const versionFile = path.join(serverPath, 'version.txt');
    if (fs.existsSync(versionFile)) {
      const version = fs.readFileSync(versionFile, 'utf8').trim();
      if (version) return version;
    }

    return null;
  } catch (error) {
    console.error('[ark-server] Error getting current version:', error);
    return null;
  }
}

// --- Install Logic ---
export function installArkServer(
  callback: (err: Error | null, output?: any) => void,
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

// --- Polling Logic ---
export async function pollArkServerUpdates(): Promise<string | null> {
  try {
    const buildId = await getLatestServerVersion();
    if (buildId && buildId !== lastKnownBuildId) {
      const prev = lastKnownBuildId;
      lastKnownBuildId = buildId;
      return prev !== null ? buildId : null;
    }
    return null;
  } catch (err) {
    console.error('[ark-server] Error during ARK update poll:', err);
    return null;
  }
}

async function getLatestServerVersion(): Promise<string | null> {
  if (!isSteamCmdInstalled()) {
    console.error('[ark-server] SteamCMD not installed');
    return null;
  }
  const steamcmdPath = getSteamCmdDir();
  const steamcmdExe = process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd.sh';
  const steamcmdExecutable = path.join(steamcmdPath, steamcmdExe);
  return new Promise((resolve) => {
    let latestBuildId: string | null = null;
    let output = '';
    const proc = spawn(steamcmdExecutable, [
      '+login', 'anonymous',
      '+app_info_update', '1',
      '+app_info_print', ARK_APP_ID.toString(),
      '+quit'
    ], { cwd: steamcmdPath });
    proc.stdout.on('data', (data) => {
      const str = data.toString();
      output += str;
      const buildIdMatch = str.match(/buildid.*?(\d+)/i);
      if (buildIdMatch) {
        latestBuildId = buildIdMatch[1];
      }
    });
    proc.stderr.on('data', (data) => {
      output += data.toString();
    });
    proc.on('close', () => {
      if (!latestBuildId) {
        console.error('[ark-server] Could not find buildid in SteamCMD output:', output);
      }
      resolve(latestBuildId);
    });
  });
}