import fs from 'fs';
import path from 'path';
import { getDefaultInstallDir } from './platform.utils';

export interface GlobalConfig {
  startWebServerOnLoad: boolean;
  webServerPort: number;
  authenticationEnabled: boolean;
  authenticationUsername: string;
  authenticationPassword: string;
  maxBackupDownloadSizeMB: number;
}

const DEFAULT_CONFIG: GlobalConfig = {
  startWebServerOnLoad: false,
  webServerPort: 3000,
  authenticationEnabled: false,
  authenticationUsername: '',
  authenticationPassword: '',
  maxBackupDownloadSizeMB: 100
};

function getConfigFilePath(): string {
  return path.join(getDefaultInstallDir(), 'global-config.json');
}

export function loadGlobalConfig(): GlobalConfig {
  try {
    const configFile = getConfigFilePath();
    if (fs.existsSync(configFile)) {
      const raw = fs.readFileSync(configFile, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } else {
      // Create config file with default values if it doesn't exist
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(configFile, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
      return { ...DEFAULT_CONFIG };
    }
  } catch (e) {
    // ignore
  }
  return { ...DEFAULT_CONFIG };
}

export function saveGlobalConfig(config: GlobalConfig): boolean {
  try {
    const configFile = getConfigFilePath();
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
}
