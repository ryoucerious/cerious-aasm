import type { AutomationSettings } from './automation.types';

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
  /** A missing flag means the event is sent. */
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
  /** Minutes between broadcasts. */
  interval?: number;
  /** What older configs called `interval`. */
  intervalMinutes?: number;
  enabled: boolean;
  nextRun?: number;
}

export interface BroadcastConfig {
  enabled?: boolean;
  messages?: ScheduledBroadcast[];
}

export interface ExclusiveJoinPlayer {
  playerId: string;
  playerName?: string;
  dateAdded?: string;
}

/**
 * An instance's config.json: the fields the backend reads. Hand-edited and imported configs are
 * not validated, so treat values defensively; every other ARK setting passes through untouched.
 */
export interface InstanceConfig extends Partial<AutomationSettings> {
  id: string;
  name?: string;
  sessionName?: string;
  /** Position in the sidebar, which Start All follows. */
  sortOrder?: number;
  /** The operator whose pool this server is in. Absent or null is the admin pool. */
  operatorUserId?: string | null;
  /** The server manager or attendant this server is assigned to. Absent or null is unassigned. */
  managerUserId?: string | null;
  mapName?: string;
  gamePort?: number | string;
  queryPort?: number | string;
  rconPort?: number | string;
  maxPlayers?: number;
  winLiveMaxPlayers?: number;
  multiHome?: string;
  altSaveDirName?: string;
  clusterId?: string;
  clusterDirOverride?: string;
  serverPlatform?: string;
  crossplay?: string[];
  launchParameters?: string;
  serverPassword?: string;
  serverAdminPassword?: string;
  rconPassword?: string;
  /** Mod ids; configs from older versions hold `{ id, enabled }` objects, hand-edited ones numbers. */
  mods?: Array<string | number | { id: string | number; enabled?: boolean }>;
  enabledMods?: Array<string | number>;
  modSettings?: Record<string, Record<string, unknown>>;
  useExclusiveList?: boolean;
  exclusiveJoinPlayers?: ExclusiveJoinPlayer[];
  exclusiveJoinPlayerIds?: string[];
  discordConfig?: DiscordWebhookConfig;
  broadcastConfig?: BroadcastConfig;
  [key: string]: unknown;
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