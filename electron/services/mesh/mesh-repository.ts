import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema';
import type { SqlExecutor } from './sql-executor';
import type {
  AuditRecord, ClusterFileRecord, ClusterRecord, CommandRecord, CommandResult, DesiredState, MeshRecord, NodeCapabilities,
  MachineAdminRecord, NodeEndpoints, NodeRecord, RoleRecord, ServerRecord, StorageHealth, StorageProfileRecord, UserRecord
} from '../../types/mesh.types';

function json<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function bool(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

/**
 * Typed access to the replicated mesh tables. Callers choose strong or local-replica reads.
 */
export class MeshRepository {
  constructor(private readonly db: SqlExecutor) {}

  async migrate(): Promise<void> {
    for (const statement of SCHEMA_STATEMENTS) {
      await this.db.exec(statement, [], 'strong');
    }
    await this.db.exec(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['schema_version', String(SCHEMA_VERSION)],
      'strong'
    );
  }

  /**
   * The rqlite credential every member uses, once it has been changed from the one the mesh was
   * created with. Null until the first change.
   */
  async getClusterCredential(): Promise<{ user: string; pass: string } | null> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT value FROM meta WHERE key = ?', ['cluster_credential'], 'none');
    const value = rows[0] ? json<{ user?: unknown; pass?: unknown } | null>(String(rows[0].value), null) : null;
    return value && typeof value.user === 'string' && typeof value.pass === 'string' ? { user: value.user, pass: value.pass } : null;
  }

  async setClusterCredential(credential: { user: string; pass: string }): Promise<void> {
    await this.db.exec(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['cluster_credential', JSON.stringify(credential)]
    );
  }

  /** This machine's copy of the mesh is current: what it reads is what the others agreed. */
  async caughtUp(): Promise<boolean> {
    return this.db.caughtUp ? this.db.caughtUp() : true;
  }

  async hasQuorum(): Promise<boolean> {
    return (await this.db.status()).hasQuorum;
  }

  async voterCount(): Promise<number> {
    return (await this.db.status()).voters;
  }

  async leaderNodeId(): Promise<string | null> {
    return (await this.db.status()).leaderNodeId;
  }

  async saveMesh(mesh: MeshRecord): Promise<void> {
    await this.db.exec(
      `INSERT INTO mesh (mesh_id, name, schema_version, security_epoch, ca_cert, ca_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mesh_id) DO UPDATE SET name = excluded.name, schema_version = excluded.schema_version,
         security_epoch = excluded.security_epoch, ca_cert = excluded.ca_cert, ca_key = excluded.ca_key`,
      [mesh.meshId, mesh.name, mesh.schemaVersion, mesh.securityEpoch, mesh.caCert, mesh.caKey, mesh.createdAt]
    );
  }

  async getMesh(meshId?: string): Promise<MeshRecord | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      meshId
        ? 'SELECT * FROM mesh WHERE mesh_id = ?'
        : 'SELECT * FROM mesh ORDER BY created_at DESC LIMIT 1',
      meshId ? [meshId] : [],
      'none'
    );
    const row = rows[0];
    if (!row) return null;
    return {
      meshId: String(row.mesh_id),
      name: String(row.name),
      schemaVersion: Number(row.schema_version),
      securityEpoch: Number(row.security_epoch),
      caCert: String(row.ca_cert),
      caKey: String(row.ca_key),
      createdAt: Number(row.created_at)
    };
  }

  /** Only the name, so nothing else a member is writing about itself at the same time is lost. */
  async setNodeName(nodeId: string, name: string): Promise<void> {
    await this.db.exec('UPDATE nodes SET name = ? WHERE node_id = ?', [name, nodeId]);
  }

  /**
   * What a machine's heartbeat records about itself, and nothing else: a rename or Skip new servers
   * made meanwhile is not written back over with what the heartbeat read before it.
   */
  async recordHeartbeat(
    nodeId: string,
    beat: Pick<NodeRecord, 'version' | 'protocolVersion' | 'certSerial' | 'capabilities' | 'lastSeen'>
  ): Promise<void> {
    await this.db.exec(
      'UPDATE nodes SET version = ?, protocol_version = ?, cert_serial = ?, capabilities = ?, last_seen = ? WHERE node_id = ?',
      [beat.version, beat.protocolVersion, beat.certSerial, JSON.stringify(beat.capabilities), beat.lastSeen, nodeId]
    );
  }

  async upsertNode(node: NodeRecord): Promise<void> {
    await this.db.exec(
      `INSERT INTO nodes (node_id, mesh_id, name, endpoints, capabilities, leader_eligible, status, last_seen,
         version, protocol_version, cert_serial, maintenance, weight)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(node_id) DO UPDATE SET mesh_id = excluded.mesh_id, name = excluded.name, endpoints = excluded.endpoints,
         capabilities = excluded.capabilities, leader_eligible = excluded.leader_eligible, status = excluded.status,
         last_seen = excluded.last_seen, version = excluded.version, protocol_version = excluded.protocol_version,
         cert_serial = excluded.cert_serial, maintenance = excluded.maintenance, weight = excluded.weight`,
      [
        node.nodeId, node.meshId, node.name, JSON.stringify(node.endpoints), JSON.stringify(node.capabilities),
        node.leaderEligible ? 1 : 0, node.status, node.lastSeen, node.version, node.protocolVersion,
        node.certSerial, node.maintenance ? 1 : 0, node.weight
      ]
    );
  }

  async listNodes(meshId?: string): Promise<NodeRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      meshId ? 'SELECT * FROM nodes WHERE mesh_id = ? ORDER BY name' : 'SELECT * FROM nodes ORDER BY name',
      meshId ? [meshId] : [],
      'none'
    );
    return rows.map(toNode);
  }

  /**
   * False while this node's copy is empty: after a restart before the first snapshot, until a
   * leader replays the log to it.
   */
  async hasCopy(): Promise<boolean> {
    const rows = await this.db.query<Record<string, unknown>>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nodes'", [], 'none');
    return rows.length > 0;
  }

  async getNode(nodeId: string): Promise<NodeRecord | null> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM nodes WHERE node_id = ?', [nodeId], 'none');
    return rows[0] ? toNode(rows[0]) : null;
  }

  async insertToken(hash: string, expiresAt: number): Promise<void> {
    await this.db.exec('INSERT INTO enrollment_tokens (token_hash, expires_at, used) VALUES (?, ?, 0)', [hash, expiresAt]);
  }

  async consumeToken(hash: string, now: number): Promise<boolean> {
    const changed = await this.db.exec(
      'UPDATE enrollment_tokens SET used = 1 WHERE token_hash = ? AND used = 0 AND expires_at > ?',
      [hash, now]
    );
    return changed === 1;
  }

  /** Why a token cannot be used: it was, it ran out, or this mesh never issued it. */
  async tokenState(hash: string, now: number): Promise<'used' | 'expired' | 'unknown' | 'valid'> {
    const [row] = await this.db.query<{ used: number; expires_at: number }>(
      'SELECT used, expires_at FROM enrollment_tokens WHERE token_hash = ?', [hash], 'strong'
    );
    if (!row) return 'unknown';
    if (Number(row.used) === 1) return 'used';
    return Number(row.expires_at) <= now ? 'expired' : 'valid';
  }

  async revokeSerial(serial: string, at: number): Promise<void> {
    await this.db.exec(
      'INSERT INTO revoked_certs (serial, revoked_at) VALUES (?, ?) ON CONFLICT(serial) DO NOTHING',
      [serial, at]
    );
  }

  async isRevoked(serial: string): Promise<boolean> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT serial FROM revoked_certs WHERE serial = ?',
      [serial],
      'none'
    );
    return rows.length > 0;
  }

  async upsertUser(user: UserRecord): Promise<void> {
    await this.db.exec(
      `INSERT INTO users (user_id, username, display_name, password_hash, password_parameters, hash_alg, enabled,
         security_version, role_id, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name,
         password_hash = excluded.password_hash, password_parameters = excluded.password_parameters,
         hash_alg = excluded.hash_alg, enabled = excluded.enabled, security_version = excluded.security_version,
         role_id = excluded.role_id, owner_user_id = excluded.owner_user_id, updated_at = excluded.updated_at`,
      [
        user.userId, user.username, user.displayName, user.passwordHash, user.passwordParameters, user.hashAlg,
        user.enabled ? 1 : 0, user.securityVersion, user.roleId, user.ownerUserId, user.createdAt, user.updatedAt
      ]
    );
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM users WHERE user_id = ?', [userId], 'none');
    return rows[0] ? toUser(rows[0]) : null;
  }

  async getUserByUsername(username: string): Promise<UserRecord | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM users WHERE lower(username) = lower(?)',
      [username],
      'none'
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async listUsers(): Promise<UserRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM users ORDER BY username', [], 'none');
    return rows.map(toUser);
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.exec('DELETE FROM users WHERE user_id = ?', [userId]);
    await this.clearMachineAdmin(userId);
  }

  /** Empty on a mesh whose schema predates machine admins: nobody is one there yet. */
  async listMachineAdmins(): Promise<MachineAdminRecord[]> {
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await this.db.query<Record<string, unknown>>('SELECT * FROM machine_admins ORDER BY user_id', [], 'none');
    } catch (error) {
      if (/no such table/i.test(error instanceof Error ? error.message : String(error))) return [];
      throw error;
    }
    return rows.map(row => ({ userId: String(row.user_id), nodeId: String(row.node_id), updatesAny: bool(row.updates_any) }));
  }

  async setMachineAdmin(userId: string, nodeId: string, updatesAny: boolean): Promise<void> {
    await this.db.exec(
      `INSERT INTO machine_admins (user_id, node_id, updates_any) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET node_id = excluded.node_id, updates_any = excluded.updates_any`,
      [userId, nodeId, updatesAny ? 1 : 0]
    );
  }

  async clearMachineAdmin(userId: string): Promise<void> {
    try {
      await this.db.exec('DELETE FROM machine_admins WHERE user_id = ?', [userId]);
    } catch (error) {
      if (!/no such table/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }

  async deleteRole(roleId: string): Promise<void> {
    await this.db.exec('DELETE FROM roles WHERE role_id = ?', [roleId]);
  }

  async upsertRole(role: RoleRecord): Promise<void> {
    await this.db.exec(
      `INSERT INTO roles (role_id, name, permission_set, security_version) VALUES (?, ?, ?, ?)
       ON CONFLICT(role_id) DO UPDATE SET name = excluded.name, permission_set = excluded.permission_set,
         security_version = excluded.security_version`,
      [role.roleId, role.name, JSON.stringify(role.permissions), role.securityVersion]
    );
  }

  async listRoles(): Promise<RoleRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM roles', [], 'none');
    return rows.map(row => ({
      roleId: String(row.role_id),
      name: String(row.name),
      permissions: json<string[]>(String(row.permission_set), []),
      securityVersion: Number(row.security_version)
    }));
  }

  async getRole(roleId: string): Promise<RoleRecord | null> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM roles WHERE role_id = ?', [roleId], 'none');
    if (!rows[0]) return null;
    return {
      roleId: String(rows[0].role_id),
      name: String(rows[0].name),
      permissions: json<string[]>(String(rows[0].permission_set), []),
      securityVersion: Number(rows[0].security_version)
    };
  }

  async upsertServer(server: ServerRecord): Promise<void> {
    await this.db.exec(
      `INSERT INTO servers (server_id, name, node_id, map_name, desired_state, config_revision, config_json,
         cluster_id, operator_user_id, manager_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id) DO UPDATE SET name = excluded.name, node_id = excluded.node_id, map_name = excluded.map_name,
         desired_state = excluded.desired_state, config_revision = excluded.config_revision, config_json = excluded.config_json,
         cluster_id = excluded.cluster_id, operator_user_id = excluded.operator_user_id, manager_user_id = excluded.manager_user_id`,
      [
        server.serverId, server.name, server.nodeId, server.mapName, server.desiredState, server.configRevision,
        server.configJson, server.clusterId, server.operatorUserId, server.managerUserId
      ]
    );
  }

  /** Only while the server is still placed on `nodeId`; a moved server is left alone. */
  async setDesiredState(serverId: string, nodeId: string, desiredState: DesiredState): Promise<void> {
    await this.db.exec(
      'UPDATE servers SET desired_state = ? WHERE server_id = ? AND node_id = ?',
      [desiredState, serverId, nodeId]
    );
  }

  /**
   * Moves a server to another node in one write, only if it is still placed on `fromNodeId`.
   * True when it moved. `desiredState` replaces the stored one when given.
   */
  async commitPlacement(serverId: string, fromNodeId: string, toNodeId: string, desiredState?: DesiredState): Promise<boolean> {
    const changed = await this.db.exec(
      'UPDATE servers SET node_id = ?, desired_state = COALESCE(?, desired_state) WHERE server_id = ? AND node_id = ?',
      [toNodeId, desiredState ?? null, serverId, fromNodeId]
    );
    return changed === 1;
  }

  async deleteServer(serverId: string): Promise<void> {
    await this.db.exec('DELETE FROM servers WHERE server_id = ?', [serverId]);
  }

  async listServers(): Promise<ServerRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM servers ORDER BY name', [], 'none');
    return rows.map(toServer);
  }

  async getServer(serverId: string): Promise<ServerRecord | null> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM servers WHERE server_id = ?', [serverId], 'none');
    return rows[0] ? toServer(rows[0]) : null;
  }

  async insertCommand(command: Omit<CommandRecord, 'status' | 'result'>): Promise<boolean> {
    try {
      await this.db.exec(
        `INSERT INTO commands (command_id, correlation_id, actor, target_node, operation, expiry, issued_at,
           expected_revision, status, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`,
        [
          command.commandId, command.correlationId, command.actor, command.targetNode, command.operation,
          command.expiry, command.issuedAt, command.expectedRevision, command.createdAt
        ]
      );
      return true;
    } catch {
      return false;
    }
  }

  async claimCommand(commandId: string): Promise<boolean> {
    const changed = await this.db.exec(
      `UPDATE commands SET status = 'running' WHERE command_id = ? AND status = 'pending'`,
      [commandId]
    );
    return changed === 1;
  }

  async completeCommand(commandId: string, status: 'done' | 'failed', result: CommandResult): Promise<void> {
    await this.db.exec(
      'UPDATE commands SET status = ?, result_json = ? WHERE command_id = ?',
      [status, JSON.stringify(result), commandId]
    );
  }

  async getCommand(commandId: string): Promise<CommandRecord | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM commands WHERE command_id = ?',
      [commandId],
      'none'
    );
    return rows[0] ? toCommand(rows[0]) : null;
  }

  async audit(event: AuditRecord): Promise<void> {
    await this.db.exec(
      `INSERT INTO audit_events (event_id, timestamp, actor, node_id, action, resource, result, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.eventId, event.timestamp, event.actor, event.nodeId, event.action, event.resource, event.result, event.correlationId]
    );
  }

  async listAudit(limit = 100): Promise<AuditRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT ?',
      [limit],
      'none'
    );
    return rows.map(row => ({
      eventId: String(row.event_id),
      timestamp: Number(row.timestamp),
      actor: String(row.actor),
      nodeId: String(row.node_id),
      action: String(row.action),
      resource: String(row.resource),
      result: String(row.result),
      correlationId: String(row.correlation_id)
    }));
  }

  async upsertCluster(cluster: ClusterRecord): Promise<void> {
    await this.db.exec(
      `INSERT INTO asa_clusters (cluster_id, name, ark_cluster_id, storage_profile_id, members)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cluster_id) DO UPDATE SET name = excluded.name, ark_cluster_id = excluded.ark_cluster_id,
         storage_profile_id = excluded.storage_profile_id, members = excluded.members`,
      [cluster.clusterId, cluster.name, cluster.arkClusterId, cluster.storageProfileId, JSON.stringify(cluster.members)]
    );
  }

  async listClusters(): Promise<ClusterRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM asa_clusters ORDER BY name', [], 'none');
    return rows.map(row => ({
      clusterId: String(row.cluster_id),
      name: String(row.name),
      arkClusterId: String(row.ark_cluster_id),
      storageProfileId: row.storage_profile_id ? String(row.storage_profile_id) : null,
      members: json<string[]>(String(row.members), [])
    }));
  }

  async getCluster(clusterId: string): Promise<ClusterRecord | null> {
    return (await this.listClusters()).find(cluster => cluster.clusterId === clusterId) ?? null;
  }

  /** Removes a cluster, its storage profile and the record of its files. The files on each machine stay. */
  async deleteCluster(clusterId: string): Promise<void> {
    const cluster = await this.getCluster(clusterId);
    await this.db.exec('DELETE FROM cluster_files WHERE cluster_id = ?', [clusterId]);
    if (cluster?.storageProfileId) await this.db.exec('DELETE FROM storage_profiles WHERE storage_profile_id = ?', [cluster.storageProfileId]);
    await this.db.exec('DELETE FROM asa_clusters WHERE cluster_id = ?', [clusterId]);
  }

  async listClusterFiles(clusterId: string): Promise<ClusterFileRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM cluster_files WHERE cluster_id = ? ORDER BY path', [clusterId], 'none'
    );
    return rows.map(row => ({
      clusterId: String(row.cluster_id),
      path: String(row.path),
      version: Number(row.version),
      sha256: String(row.sha256),
      size: Number(row.size),
      deleted: Number(row.deleted) === 1,
      originNode: String(row.origin_node),
      updatedAt: Number(row.updated_at)
    }));
  }

  /**
   * Records a new version of a cluster file, only on top of `baseVersion`: 0 for a file the mesh
   * has never recorded. Returns the new version, or null when another machine got there first.
   */
  async commitClusterFile(
    file: Pick<ClusterFileRecord, 'clusterId' | 'path' | 'sha256' | 'size' | 'deleted' | 'originNode'>,
    baseVersion: number
  ): Promise<number | null> {
    const values = [file.sha256, file.size, file.deleted ? 1 : 0, file.originNode, Date.now()];
    if (baseVersion === 0) {
      const added = await this.db.exec(
        `INSERT INTO cluster_files (cluster_id, path, version, sha256, size, deleted, origin_node, updated_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?) ON CONFLICT(cluster_id, path) DO NOTHING`,
        [file.clusterId, file.path, ...values]
      );
      return added === 1 ? 1 : null;
    }
    const changed = await this.db.exec(
      `UPDATE cluster_files SET version = version + 1, sha256 = ?, size = ?, deleted = ?, origin_node = ?, updated_at = ?
       WHERE cluster_id = ? AND path = ? AND version = ?`,
      [...values, file.clusterId, file.path, baseVersion]
    );
    return changed === 1 ? baseVersion + 1 : null;
  }

  /** The schema version the mesh was last brought up to; 0 when it was never recorded. */
  async schemaVersion(): Promise<number> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT value FROM meta WHERE key = ?', ['schema_version'], 'none');
    return Number(rows[0]?.value) || 0;
  }

  async upsertStorage(profile: StorageProfileRecord): Promise<void> {
    await this.db.exec(
      `INSERT INTO storage_profiles (storage_profile_id, mode, authority_node_id, metadata, health)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(storage_profile_id) DO UPDATE SET mode = excluded.mode, authority_node_id = excluded.authority_node_id,
         metadata = excluded.metadata, health = excluded.health`,
      [profile.storageProfileId, profile.mode, profile.authorityNodeId, JSON.stringify(profile.metadata), JSON.stringify(profile.health)]
    );
  }

  async listStorage(): Promise<StorageProfileRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM storage_profiles', [], 'none');
    return rows.map(toStorage);
  }

  async getStorage(id: string): Promise<StorageProfileRecord | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM storage_profiles WHERE storage_profile_id = ?',
      [id],
      'none'
    );
    return rows[0] ? toStorage(rows[0]) : null;
  }
}

function toNode(row: Record<string, unknown>): NodeRecord {
  return {
    nodeId: String(row.node_id),
    meshId: String(row.mesh_id),
    name: String(row.name),
    endpoints: json<NodeEndpoints>(String(row.endpoints), { peerUrl: '', raftAddr: '', httpAddr: '' }),
    capabilities: json<NodeCapabilities>(String(row.capabilities), {
      platform: 'linux', docker: false, proton: false, installPresent: false,
      freeMemoryBytes: 0, freeDiskBytes: 0, cpuPercent: 0
    }),
    leaderEligible: bool(row.leader_eligible),
    status: String(row.status) as NodeRecord['status'],
    lastSeen: Number(row.last_seen),
    version: String(row.version),
    protocolVersion: Number(row.protocol_version),
    certSerial: String(row.cert_serial),
    maintenance: bool(row.maintenance),
    weight: Number(row.weight)
  };
}

function toUser(row: Record<string, unknown>): UserRecord {
  return {
    userId: String(row.user_id),
    username: String(row.username),
    displayName: String(row.display_name),
    passwordHash: String(row.password_hash),
    passwordParameters: String(row.password_parameters),
    hashAlg: String(row.hash_alg) === 'bcrypt' ? 'bcrypt' : 'argon2id',
    enabled: bool(row.enabled),
    securityVersion: Number(row.security_version),
    roleId: String(row.role_id),
    ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function toServer(row: Record<string, unknown>): ServerRecord {
  return {
    serverId: String(row.server_id),
    name: String(row.name),
    nodeId: String(row.node_id),
    mapName: String(row.map_name || ''),
    desiredState: String(row.desired_state) === 'running' ? 'running' : 'stopped',
    configRevision: Number(row.config_revision),
    configJson: String(row.config_json || '{}'),
    clusterId: row.cluster_id ? String(row.cluster_id) : null,
    operatorUserId: row.operator_user_id ? String(row.operator_user_id) : null,
    managerUserId: row.manager_user_id ? String(row.manager_user_id) : null
  };
}

function toCommand(row: Record<string, unknown>): CommandRecord {
  return {
    commandId: String(row.command_id),
    correlationId: String(row.correlation_id),
    actor: String(row.actor),
    targetNode: String(row.target_node),
    operation: String(row.operation),
    expiry: Number(row.expiry),
    issuedAt: Number(row.issued_at),
    expectedRevision: row.expected_revision == null ? null : Number(row.expected_revision),
    status: String(row.status) as CommandRecord['status'],
    result: row.result_json ? json<CommandResult>(String(row.result_json), { success: false }) : null,
    createdAt: Number(row.created_at)
  };
}

function toStorage(row: Record<string, unknown>): StorageProfileRecord {
  return {
    storageProfileId: String(row.storage_profile_id),
    mode: String(row.mode) === 'managed' ? 'managed' : 'shared-path',
    authorityNodeId: row.authority_node_id ? String(row.authority_node_id) : null,
    metadata: json<Record<string, unknown>>(String(row.metadata), {}),
    health: json<StorageHealth>(String(row.health), { ok: false, degraded: true, detail: '', checkedAt: 0, perNode: {} })
  };
}
