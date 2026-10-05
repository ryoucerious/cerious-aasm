/** Wire protocol. A peer on a newer major version is refused. */
export const PROTOCOL_VERSION = 1;

export function protocolError(peer: number, local = PROTOCOL_VERSION): string | null {
  if (peer === local) return null;
  return `Protocol ${peer} is not compatible with ${local}.`;
}

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
  operation: 'start' | 'stop' | 'force-stop' | 'restart' | 'update-ark' | 'update-app';
  serverId: string;
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
