/**
 * Applied on the Raft leader when a mesh is created, and again by any member that finds the
 * mesh on an older version. Every statement can run more than once. Followers receive them
 * through the log.
 */
export const SCHEMA_VERSION = 3;

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mesh (
    mesh_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    security_epoch INTEGER NOT NULL,
    ca_cert TEXT NOT NULL,
    ca_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS nodes (
    node_id TEXT PRIMARY KEY,
    mesh_id TEXT NOT NULL,
    name TEXT NOT NULL,
    endpoints TEXT NOT NULL,
    capabilities TEXT NOT NULL,
    leader_eligible INTEGER NOT NULL,
    status TEXT NOT NULL,
    last_seen INTEGER NOT NULL,
    version TEXT NOT NULL,
    protocol_version INTEGER NOT NULL,
    cert_serial TEXT NOT NULL,
    maintenance INTEGER NOT NULL DEFAULT 0,
    weight REAL NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS enrollment_tokens (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS revoked_certs (
    serial TEXT PRIMARY KEY,
    revoked_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_parameters TEXT NOT NULL,
    hash_alg TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    security_version INTEGER NOT NULL,
    role_id TEXT NOT NULL,
    owner_user_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS roles (
    role_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    permission_set TEXT NOT NULL,
    security_version INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS servers (
    server_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    node_id TEXT NOT NULL,
    map_name TEXT NOT NULL DEFAULT '',
    desired_state TEXT NOT NULL,
    config_revision INTEGER NOT NULL,
    config_json TEXT NOT NULL,
    cluster_id TEXT,
    operator_user_id TEXT,
    manager_user_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS commands (
    command_id TEXT PRIMARY KEY,
    correlation_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    target_node TEXT NOT NULL,
    operation TEXT NOT NULL,
    expiry INTEGER NOT NULL,
    issued_at INTEGER NOT NULL,
    expected_revision INTEGER,
    status TEXT NOT NULL,
    result_json TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    event_id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    actor TEXT NOT NULL,
    node_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    result TEXT NOT NULL,
    correlation_id TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS asa_clusters (
    cluster_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ark_cluster_id TEXT NOT NULL,
    storage_profile_id TEXT,
    members TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS storage_profiles (
    storage_profile_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    authority_node_id TEXT,
    metadata TEXT NOT NULL,
    health TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS storage_objects (
    object_key TEXT NOT NULL,
    version INTEGER NOT NULL,
    hash TEXT NOT NULL,
    size INTEGER NOT NULL,
    committed INTEGER NOT NULL,
    tombstone INTEGER NOT NULL,
    PRIMARY KEY (object_key, version)
  )`,
  // Version 3: the machine each machine admin looks after, and whether a mesh admin let it update
  // every machine. A table of its own, so a node on an older version reads its users as before.
  `CREATE TABLE IF NOT EXISTS machine_admins (
    user_id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    updates_any INTEGER NOT NULL DEFAULT 0
  )`,
  // Version 2: the transfer files of each cluster whose files the app keeps on every machine.
  // One row per file, at its latest version; a deleted file keeps its row so an old copy
  // cannot bring it back.
  `CREATE TABLE IF NOT EXISTS cluster_files (
    cluster_id TEXT NOT NULL,
    path TEXT NOT NULL,
    version INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    size INTEGER NOT NULL,
    deleted INTEGER NOT NULL,
    origin_node TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (cluster_id, path)
  )`
];
