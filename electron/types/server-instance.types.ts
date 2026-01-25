export interface ServerInstanceResult {
  success: boolean;
  error?: string;
  instanceId?: string;
  instanceName?: string;
  shouldNotifyAutomation?: boolean;
}

export interface DiscordWebhookConfig {
  enabled: boolean;
  webhookUrl: string;
  notifications?: {
    serverStart?: boolean;
    serverStop?: boolean;
    serverCrash?: boolean;
    serverUpdate?: boolean;
    serverJoin?: boolean;
    serverLeave?: boolean;
  };
}

export interface ScheduledBroadcast {
  id: string;
  message: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRun?: number;
}

export interface ServerStateResult {
  state: string;
  instanceId: string;
}

export interface ServerLogsResult {
  log: string;
  instanceId: string;
}

export interface RconResult {
  success: boolean;
  connected?: boolean;
  response?: string;
  instanceId: string;
  error?: string;
}

export interface StartServerResult {
  started: boolean;
  portError?: string;
  instanceId: string;
  instanceName?: string;
}

export interface PlayerCountResult {
  instanceId: string;
  players: number;
}

export interface InstancesResult {
  instances: any[];
}

export interface SingleInstanceResult {
  instance: any;
}

export interface SaveInstanceResult {
  success: boolean;
  instance?: any;
  error?: string;
}

export interface DeleteInstanceResult {
  success: boolean;
  id: string;
}

export interface ImportBackupResult {
  success: boolean;
  instance?: any;
  message?: string;
  error?: string;
}