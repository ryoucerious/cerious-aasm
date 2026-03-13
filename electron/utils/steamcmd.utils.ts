
import * as path from 'path';
import * as pty from 'node-pty';
import { getDefaultInstallDir } from './platform.utils';
import { runInstaller } from './installer.utils';
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

export function installSteamCmd(callback: (err: Error | null, output?: string) => void, onData?: (data: any) => void) {
  const dir = getSteamCmdDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const url = process.platform === 'win32'
    ? 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
    : 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz';
  const archivePath = path.join(dir, process.platform === 'win32' ? 'steamcmd.zip' : 'steamcmd_linux.tar.gz');
  runInstaller(
    {
      command: process.platform === 'win32' ? 'powershell.exe' : 'bash',
      args: process.platform === 'win32'
        ? ['-Command', `Invoke-WebRequest -Uri \"${url}\" -OutFile \"${archivePath}\"`]
        : ['-c', `curl -L ${url} -o ${archivePath}`],
      cwd: dir,
      estimatedTotal: process.platform === 'win32' ? 5 * 1024 * 1024 : undefined,
      phaseSplit: 50,
      parseProgress: (data, lastPercent, estimatedTotal) => {
        if (process.platform === 'win32') {
          const match = /Number of bytes written: (\d+)/.exec(data);
          if (match && estimatedTotal) {
            const bytes = parseInt(match[1], 10);
            let percent = Math.floor((bytes / estimatedTotal) * 50);
            if (percent > 50) percent = 50;
            return percent > lastPercent ? percent : null;
          }
          return null;
        } else {
          return lastPercent < 50 ? lastPercent + 5 : null;
        }
      },
      extractPhase: () => process.platform === 'win32'
        ? {
            command: 'powershell.exe',
            args: ['-Command', `Expand-Archive -Path \"${archivePath}\" -DestinationPath \"${dir}\" -Force`],
            cwd: dir,
          }
        : {
            command: 'bash',
            args: ['-c', `tar -xzf ${archivePath} -C ${dir}`],
            cwd: dir,
          },
    },
    // Only send structured progress, not raw terminal output
    (progress) => {
      if (onData) {
        onData(progress);
      }
    },
    (err, output) => {
      // On Linux, ensure steamcmd.sh is executable after extraction
      if (!err && process.platform !== 'win32') {
        const steamcmdSh = path.join(dir, 'steamcmd.sh');
        if (fs.existsSync(steamcmdSh)) {
          try { fs.chmodSync(steamcmdSh, '755'); } catch (e) {
            console.warn('[steamcmd] Could not chmod steamcmd.sh:', e);
          }
        }
      }
      if (err) {
        callback(err, output);
        return;
      }
      // SteamCMD must self-update on first run before it can process commands.
      // Run it once with +quit to complete the self-update.
      initializeSteamCmd(dir, onData, () => {
        callback(null, output);
      });
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
