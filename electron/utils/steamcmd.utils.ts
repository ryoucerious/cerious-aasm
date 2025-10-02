
import * as path from 'path';
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
    (err, output) => callback(err, output)
  );
}

// Inline exports are used above
