import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema';
import type { SqlExecutor } from './sql-executor';
import type {
  AuditRecord, ClusterRecord, CommandRecord, CommandResult, DesiredState, MeshRecord, NodeCapabilities,
  NodeEndpoints, NodeRecord, RoleRecord, ServerRecord, StorageHealth, StorageProfileRecord, UserRecord
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
