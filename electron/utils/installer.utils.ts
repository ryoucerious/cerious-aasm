
import * as pty from 'node-pty';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { getDefaultInstallDir } from './platform.utils';

export interface InstallerOptions {
  command: string;
  args: string[];
  cwd: string;
  estimatedTotal?: number;
  phaseSplit?: number;
  parseProgress?: (data: string, lastPercent: number, estimatedTotal?: number) => number | null;
  extractPhase?: () => InstallerOptions | null;
}


  export let currentProc: pty.IPty | null = null;
  export let currentExtractProc: pty.IPty | null = null;
  export let procKilled = false;
  export let extractProcKilled = false;

  // Reset function for testing
  export function resetInstallerState() {
    currentProc = null;
    currentExtractProc = null;
    procKilled = false;
    extractProcKilled = false;
  }

  // File-based lock for cross-process install prevention (use installDir)
  const LOCK_FILE = path.join(getDefaultInstallDir(), 'install.lock');

  export function isInstallLocked(): boolean {
    try {
      return fs.existsSync(LOCK_FILE);
    } catch {
      return false;
    }
  }

  export function createInstallLock(): void {
    try {
      fs.ensureFileSync(LOCK_FILE);
      fs.writeFileSync(LOCK_FILE, String(Date.now()));
    } catch {}
  }

  export function removeInstallLock(): void {
    try {
      if (fs.existsSync(LOCK_FILE)) fs.removeSync(LOCK_FILE);
    } catch {}
  }

  // Emergency: forcibly clear the lock (e.g., via admin UI)
  export function forceClearInstallLock(): void {
    removeInstallLock();
  }

  export function cancelInstaller() {
    if (currentProc) {
      try {
        procKilled = true;
        currentProc.kill();
      } catch (e) {
        // ignore
      }
      currentProc = null;
    }
    if (currentExtractProc) {
      try {
        extractProcKilled = true;
        // Remove all listeners to prevent further event handling after kill
        if (typeof (currentExtractProc as any).removeAllListeners === 'function') {
          (currentExtractProc as any).removeAllListeners();
        }
        currentExtractProc.kill();
      } catch (e) {
        // ignore
      }
      currentExtractProc = null;
    }
  }

  export function runInstaller(
    options: InstallerOptions,
    onProgress: (progress: { percent: number; step: string; message: string }) => void,
    onDone: (err: Error | null, output?: string) => void
  ) {
    let output = '';
    let lastPercent = 0;
    const phaseSplit = options.phaseSplit ?? 50;
    onProgress({ percent: 0, step: 'download', message: 'Checking Ark Server...' });
    let proc: pty.IPty;
    try {
      proc = pty.spawn(options.command, options.args, { cwd: options.cwd });
    } catch (spawnErr: any) {
      const msg = spawnErr?.message || String(spawnErr);
      onProgress({ percent: 0, step: 'error', message: `Failed to start process: ${msg}` });
      return onDone(new Error(`Failed to start process "${options.command}": ${msg}`));
    }
    procKilled = false;
    currentProc = proc;
    proc.onData((data) => {
      if (procKilled || !currentProc) return;
      try {
        output += data;
        let percent = lastPercent;
        if (options.parseProgress) {
          const parsed = options.parseProgress(data, lastPercent, options.estimatedTotal);
          if (parsed !== null && parsed > lastPercent) {
            percent = parsed;
            lastPercent = percent;
            onProgress({ percent, step: 'download', message: `Downloading... (${percent}%)` });
          }
        }
      } catch (err) {
        // ignore errors after kill
      }
    });
    proc.onExit((result) => {
      if (procKilled) {
        currentProc = null;
        return;
      }
      currentProc = null;
      const steamcmdSuccess = output.includes('Success! App') && output.includes('fully installed');
      if (result.exitCode !== 0 && !steamcmdSuccess) {
        onProgress({ percent: lastPercent, step: 'error', message: 'Failed to download.' });
        return onDone(new Error('Failed to download.'));
      }
      if (options.extractPhase) {
        const extractOpts = options.extractPhase();
        if (extractOpts) {
          let extractPercent = phaseSplit;
          onProgress({ percent: extractPercent, step: 'extract', message: 'Download complete. Extracting...' });
          const extractProc = pty.spawn(extractOpts.command, extractOpts.args, { cwd: extractOpts.cwd });
          extractProcKilled = false;
          currentExtractProc = extractProc;
          extractProc.onData((data) => {
            if (extractProcKilled || !currentExtractProc) return;
            try {
              output += data;
              if (extractPercent < 99) {
                extractPercent += 5;
                if (extractPercent > 99) extractPercent = 99;
                onProgress({ percent: extractPercent, step: 'extract', message: 'Extracting...' });
              }
            } catch (err) {
              // ignore errors after kill
            }
          });
          extractProc.onExit((res) => {
            if (extractProcKilled) {
              currentExtractProc = null;
              return;
            }
            currentExtractProc = null;
            if (res.exitCode !== 0) {
              onProgress({ percent: extractPercent, step: 'error', message: 'Failed to extract.' });
              return onDone(new Error('Failed to extract.'));
            }
            onProgress({ percent: 100, step: 'complete', message: 'Extraction complete.' });
            onDone(null, output);
          });
        }
      } else {
        onProgress({ percent: 100, step: 'complete', message: 'Download complete.' });
        onDone(null, output);
      }
    });
  }

  // Inline exports above; no bottom export list required
