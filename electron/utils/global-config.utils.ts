import fs from 'fs';
import path from 'path';
import { getDefaultInstallDir } from './platform.utils';
import { readJsonOrQuarantine, writeJsonAtomic } from './fs.utils';
import type { ServerPortRanges } from './ark/port-sets';

export interface GlobalConfig {
  startWebServerOnLoad: boolean;
  webServerPort: number;
  authenticationEnabled: boolean;
  authenticationUsername: string;
  authenticationPassword: string;
  maxBackupDownloadSizeMB: number;
  /** Where the servers live; empty means the default install dir. */
  serverDataDir?: string;
  autoUpdateArkServer?: boolean;
  /** Minutes of warning players get before an update restarts their server. */
  updateWarningMinutes?: number;
  /** Seconds between servers when several start together. */
  serverStartDelaySeconds?: number;
  curseForgeApiKey?: string;
  /** Where this machine's servers take their ports from; unset means the defaults. Ignored in Docker. */
  serverPorts?: ServerPortRanges;
}

const DEFAULT_CONFIG: GlobalConfig = {
  startWebServerOnLoad: false,
  webServerPort: 3000,
  authenticationEnabled: false,
  authenticationUsername: '',
  authenticationPassword: '',
  maxBackupDownloadSizeMB: 100,
  serverDataDir: '',
  autoUpdateArkServer: false,
  updateWarningMinutes: 15,
  serverStartDelaySeconds: 60,
  curseForgeApiKey: '',
};

// loadGlobalConfig runs on almost every request, so a persistent failure is logged once.
let lastReportedLoadFailure: string | undefined;

function getConfigFilePath(): string {
  return path.join(getDefaultInstallDir(), 'global-config.json');
}

export function loadGlobalConfig(): GlobalConfig {
  try {
    const configFile = getConfigFilePath();
    const stored = readJsonOrQuarantine<Partial<GlobalConfig>>(configFile);
    if (stored !== undefined) {
      lastReportedLoadFailure = undefined;
      return { ...DEFAULT_CONFIG, ...stored };
    }
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    writeJsonAtomic(configFile, DEFAULT_CONFIG);
    lastReportedLoadFailure = undefined;
  } catch (error) {
    // Defaults without writing them: an unreadable file may still hold the user's settings.
    const failure = describeFailure(error);
    if (failure !== lastReportedLoadFailure) {
      lastReportedLoadFailure = failure;
      console.error('[global-config] Failed to load the global config; using defaults:', error);
    }
  }
  return { ...DEFAULT_CONFIG };
}

function describeFailure(error: unknown): string {
  const { code, path: filePath } = (error ?? {}) as NodeJS.ErrnoException;
  return `${filePath ?? ''}:${code ?? String(error)}`;
}

export function saveGlobalConfig(config: GlobalConfig): boolean {
  try {
    const configFile = getConfigFilePath();
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    writeJsonAtomic(configFile, config);
    return true;
  } catch (error) {
    console.error('[global-config] Failed to save the global config:', error);
    return false;
  }
}
