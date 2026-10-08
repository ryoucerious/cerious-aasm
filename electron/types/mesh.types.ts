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
  'set-ownership': 2,
  'set-address': 2,
  'ark-api': 2
};

/** Read-only questions one node asks the node hosting a server. Not commands: never logged, no quorum. */
export type MeshQuery = 'state' | 'logs' | 'players' | 'rcon-status' | 'online-players' | 'ini' | 'ark-api';
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
  /** Set when a status snapshot is built: the host other nodes dial, from the peer URL. */
  host?: string;
  /** Set when a status snapshot is built: from its last heartbeat, null once that is stale. */
  resources?: NodeResources | null;
  /** Set when a status snapshot is built: how its copy of each cluster's files stands. Null once stale. */
  clusterSync?: Record<string, ClusterSyncStatus> | null;
  /** Set when a status snapshot is built: where the others reach it, from its peer URL and Raft address. */
  address?: MeshAddress | null;
  /** Set when a status snapshot is built: how an ARK update on it is going, if one is. */
  arkUpdate?: ArkUpdateStatus | null;
}

/**
 * Where other machines reach a member: a host, and the ports they dial. Behind a port forward
 * the ports can differ from the ones the member listens on.
 */
export interface MeshAddress {
  host: string;
  /** The peer API: status, commands, moves, cluster files. */
  peerPort: number;
  /** The mesh database (Raft). */
  raftPort: number;
}

/**
 * How an ARK update on a machine is going: copying the install and downloading while its servers run,
 * warning players, stopping, putting the new files in place, restarting, or how it ended.
 */
export interface ArkUpdateStatus {
  phase: 'copying' | 'downloading' | 'warning' | 'stopping' | 'updating' | 'configuring' | 'starting' | 'complete' | 'error';
  message: string;
  minutesLeft?: number;
  percent?: number;
  at: number;
}

/** How one machine's copy of a cluster's transfer files stands. */
export interface ClusterSyncStatus {
  files: number;
  pendingSend: number;
  pendingReceive: number;
  conflicts: number;
  lastSyncAt: number;
  error: string | null;
}

/** CPU, memory and disk of a machine. Disk is the volume holding the app's data; null when it cannot be read. */
export interface NodeResources {
  cpuPercent: number;
  memory: { used: number; total: number };
  disk: { used: number; total: number } | null;
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

/** One member of the Raft cluster: its node id and the address the others reach its Raft port at. */
export interface RaftMember {
  id: string;
  address: string;
}

/** What a member asks the others when a mesh without quorum forces machines out. */
export interface ForceRemoval {
  phase: 'prepare' | 'apply';
  removing: string[];
  members: RaftMember[];
}

/** A machine admin's machine. */
export interface MachineAdminRecord {
  userId: string;
  nodeId: string;
  /** Granted by a mesh admin: it may update ARK and the app on every machine. */
  updatesAny: boolean;
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

/** One transfer file of a cluster whose files the app keeps on every machine, at its latest version. */
export interface ClusterFileRecord {
  clusterId: string;
  /** Relative to the cluster's folder, with forward slashes. */
  path: string;
  version: number;
  sha256: string;
  size: number;
  /** Removed: no machine may bring it back from an older copy. */
  deleted: boolean;
  /** The machine that recorded this version, which holds its contents. */
  originNode: string;
  updatedAt: number;
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
    | 'update-ark' | 'update-app' | 'set-address' | 'ark-api';
  serverId: string;
  /** Move only: the node that receives the server. */
  destinationNodeId?: string;
  /** save-config only: the server config to save on the hosting node. */
  instance?: Record<string, unknown>;
  /** start-all and stop-all only: the servers on the target node to act on. */
  serverIds?: string[];
  /**
   * rcon: { command }. save-ini: { filename, content }. set-ownership: { operatorUserId, managerUserId }.
   * set-address: a MeshAddress. ark-api: { action } and what that action needs (see ark-api-actions).
   */
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
  /** In a mesh, but not yet back in touch with it after a restart. Not standalone: it must not offer to create or join one. */
  reconnecting?: boolean;
  /** Where other machines reach this one: as it joined with, or, outside a mesh, as it would advertise. */
  advertise?: MeshAddress;
  /** Outside a mesh: why this machine cannot run the mesh database, so it cannot create or join one. */
  blocker?: string | null;
  /** Every machine this one reaches refuses it as no longer a member: the others removed it. */
  removedFromMesh?: boolean;
  nodes: NodeRecord[];
  clusters: ClusterRecord[];
  storage: StorageProfileRecord[];
}
