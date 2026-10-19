export interface GlobalConfig {
  backupLocation?: string;
  /** Absolute path for mesh backup copies. Empty keeps them next to the server data. */
  backupCopiesLocation?: string;
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
  /** How long a web sign-in with "remember me" lasts. */
  rememberMeDays?: number;
}
