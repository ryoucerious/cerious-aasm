/**
 * Wire protocol. 2 adds the delete, move, save-config, start-all and stop-all commands and
 * streamed checkpoints. A peer on a newer version, or older than MIN_PROTOCOL_VERSION, is refused.
 */
export const PROTOCOL_VERSION = 2;
export const MIN_PROTOCOL_VERSION = 1;

export function protocolError(peer: number, local = PROTOCOL_VERSION): string | null {
  if (Number.isInteger(peer) && peer >= MIN_PROTOCOL_VERSION && peer <= local) return null;
  return `Protocol ${peer} is not compatible with ${local}.`;
}

/**
 * The protocol a node must run to take each command. A command for an older node is refused
 * where it is sent, with a reason, instead of failing there as an unknown operation.
 */
export const COMMAND_PROTOCOL: Record<ControlCommand['operation'], number> = {
  start: 1,
  stop: 1,
  'force-stop': 1,
  restart: 1,
  'update-ark': 1,
  'update-app': 1,
  delete: 2,
  move: 2,
  'save-config': 2,
  'start-all': 2,
  'stop-all': 2,
  rcon: 2,
  'connect-rcon': 2,
  'disconnect-rcon': 2,
  'save-ini': 2,
  'set-ownership': 2
};

/** Read-only questions one node asks the node hosting a server. Not commands: never logged, no quorum. */
export type MeshQuery = 'state' | 'logs' | 'players' | 'rcon-status' | 'online-players' | 'ini';
export const QUERY_PROTOCOL = 2;

/** Commands issued further from now than this are refused. Raft does not depend on this clock. */
export const COMMAND_SKEW_MS = 5 * 60 * 1000;

export type DesiredState = 'running' | 'stopped';
export type NodeStatus = 'joining' | 'alive' | 'removed' | 'maintenance';
export type CommandStatus = 'pending' | 'running' | 'done' | 'failed';
export type StorageMode = 'shared-path' | 'managed';

export interface MeshRecord {
  meshId: string;
  name: string;
  schemaVersion: number;
  securityEpoch: number;
  caCert: string;
  caKey: string;
  createdAt: number;
}

export interface NodeRecord {
  nodeId: string;
  meshId: string;
  name: string;
  endpoints: NodeEndpoints;
  capabilities: NodeCapabilities;
  leaderEligible: boolean;
  status: NodeStatus;
  lastSeen: number;
  version: string;
  protocolVersion: number;
  certSerial: string;
  maintenance: boolean;
  weight: number;
  /** Set when a status snapshot is built. A recent heartbeat or this machine itself. */
  connected?: boolean;
}

export interface NodeEndpoints {
  peerUrl: string;
  raftAddr: string;
  httpAddr: string;
}

export interface NodeCapabilities {
  platform: 'windows' | 'linux';
  docker: boolean;
  proton: boolean;
  installPresent: boolean;
  freeMemoryBytes: number;
  freeDiskBytes: number;
  cpuPercent: number;
}

export interface UserRecord {
  userId: string;
  username: string;
  displayName: string;
  passwordHash: string;
  passwordParameters: string;
  hashAlg: 'argon2id' | 'bcrypt';
  enabled: boolean;
  securityVersion: number;
  roleId: string;
  ownerUserId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RoleRecord {
  roleId: string;
  name: string;
  permissions: string[];
  securityVersion: number;
}

export interface ServerRecord {
  serverId: string;
  name: string;
  nodeId: string;
  mapName: string;
  desiredState: DesiredState;
  configRevision: number;
  configJson: string;
  clusterId: string | null;
  operatorUserId: string | null;
  managerUserId: string | null;
}

export interface CommandRecord {
  commandId: string;
  correlationId: string;
  actor: string;
  targetNode: string;
  operation: string;
  expiry: number;
  issuedAt: number;
  expectedRevision: number | null;
  status: CommandStatus;
  result: CommandResult | null;
  createdAt: number;
}

export interface CommandResult {
  success: boolean;
  error?: string;
  detail?: unknown;
}

export interface AuditRecord {
  eventId: string;
  timestamp: number;
  actor: string;
  nodeId: string;
  action: string;
  resource: string;
  result: string;
  correlationId: string;
}

export interface ClusterRecord {
  clusterId: string;
  name: string;
  arkClusterId: string;
  storageProfileId: string | null;
  members: string[];
}

export interface StorageProfileRecord {
  storageProfileId: string;
  mode: StorageMode;
  authorityNodeId: string | null;
  metadata: Record<string, unknown>;
  health: StorageHealth;
}

export interface StorageHealth {
  ok: boolean;
  degraded: boolean;
  detail: string;
  checkedAt: number;
  perNode: Record<string, { ok: boolean; latencyMs: number; identity: string; error?: string }>;
}

export interface ControlCommand {
  commandId: string;
  correlationId: string;
  actor: string;
  targetNode: string;
  operation: 'start' | 'stop' | 'force-stop' | 'restart' | 'delete' | 'move' | 'save-config'
    | 'start-all' | 'stop-all' | 'rcon' | 'connect-rcon' | 'disconnect-rcon' | 'save-ini' | 'set-ownership'
    | 'update-ark' | 'update-app';
  serverId: string;
  /** Move only: the node that receives the server. */
  destinationNodeId?: string;
  /** save-config only: the server config to save on the hosting node. */
  instance?: Record<string, unknown>;
  /** start-all and stop-all only: the servers on the target node to act on. */
  serverIds?: string[];
  /** rcon: { command }. save-ini: { filename, content }. set-ownership: { operatorUserId, managerUserId }. */
  args?: Record<string, unknown>;
  expiry: number;
  issuedAt: number;
  expectedRevision: number | null;
}

export interface MeshStatus {
  enabled: boolean;
  degraded: boolean;
  meshId: string | null;
  meshName: string | null;
  nodeId: string | null;
  nodeName: string | null;
  leaderNodeId: string | null;
  voterCount: number;
  hasQuorum: boolean;
  protocolVersion: number;
  warning: string | null;
  /** False when the mesh has no accounts yet, so the desktop can create the first one. */
  hasAccounts: boolean;
  nodes: NodeRecord[];
  clusters: ClusterRecord[];
  storage: StorageProfileRecord[];
}
