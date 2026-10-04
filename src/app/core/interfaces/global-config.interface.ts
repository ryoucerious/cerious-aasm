export interface GlobalConfig {
  startWebServerOnLoad: boolean;
  webServerPort: number;
  authenticationEnabled: boolean;
  authenticationUsername: string;
  /** Whether that login has a password. The password itself is never sent to clients. */
  authenticationPasswordSet: boolean;
  maxBackupDownloadSizeMB: number;
  serverDataDir?: string;
  autoUpdateArkServer?: boolean;
  updateWarningMinutes?: number;
  serverStartDelaySeconds?: number;
  curseForgeApiKey?: string;
}
