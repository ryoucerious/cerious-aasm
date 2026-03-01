export interface GlobalConfig {
  startWebServerOnLoad: boolean;
  webServerPort: number;
  authenticationEnabled: boolean;
  authenticationUsername: string;
  authenticationPassword: string;
  maxBackupDownloadSizeMB: number;
  serverDataDir?: string;
  autoUpdateArkServer?: boolean;
  updateWarningMinutes?: number;
  curseForgeApiKey?: string;
}
