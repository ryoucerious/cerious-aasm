# Cerious-AASM Mesh --- Agent Implementation Instructions

## Objective

Implement the architecture in `README.md` and `ARCHITECTURE.md`
incrementally inside the existing Cerious-AASM codebase. Preserve
standalone behavior throughout.

## Do not change without review

-   No permanent main node dependency for ARK runtime.
-   No game-server restart/stop because leadership changes.
-   No central-machine dependency for every user login.
-   No plaintext password replication.
-   No conflicting security/membership writes from isolated nodes by
    default.
-   No generic eventual file sync as final ASA transfer storage.
-   No public SMB/NFS recommendation.
-   No unnecessary split into unrelated controller/agent products.
-   No high-frequency telemetry in strongly consistent state without
    need.
-   No casually invented consensus algorithm.
-   Do not begin with AASM Managed Transfer Storage.

## Phase 0 --- Boundaries

1.  Inventory current lifecycle, auth, persistence, API, UI/Electron,
    Docker, Linux, Windows, and Unraid code.
2.  Extract local server runtime interfaces.
3.  Make standalone UI/API use those interfaces.
4.  Add stable `MeshId`, `NodeId`, `ServerId`, `ClusterId`.
5.  Separate local operational state from replicated Mesh state.
6.  Add configuration/entity revisions.
7.  Preserve existing behavior.

## Phase 1 --- Secure remote nodes

Implement Mesh creation, enrollment tokens, asymmetric node identity,
mTLS/equivalent trust, node registry, heartbeat, capabilities, version
negotiation, global inventory, remote start/stop/restart, idempotent
commands, and audit.

A temporary coordinator is acceptable only if ARK runtime is not coupled
to it.

## Phase 2 --- Identity/RBAC

Implement Mesh users, Argon2id verifiers, roles/capabilities, resource
scopes, local authentication from replicated identity,
`SecurityVersion`, short-lived sessions/tokens, revocation, audit, and
partition restrictions.

## Phase 3 --- HA control plane

Implement replicated authoritative state, leader election,
snapshots/recovery, membership changes, reconnect/catch-up, and rolling
compatibility. Prove leader loss does not alter ARK process lifetime.

## Phase 4 --- ASA cluster orchestration

Implement logical ASA clusters, common ARK cluster ID management,
cross-node map membership, `IClusterStorageProvider`, shared-path
provider, per-node validation, storage-health UI, and explicit degraded
transfer state.

## Phase 5 --- Cross-network support

Add diagnostics and optional private-overlay/WireGuard-style assistance
while keeping Mesh protocol independent from the overlay technology.

## Phase 6 --- AASM Managed Transfer Storage

Only begin after Phases 0--5 are stable. First write a dedicated design
for completed-write detection, commit/durability semantics, atomic
materialization, tombstones/consumption, checksums, duplicate delivery,
authority failure, replica promotion, and recovery.

## Phase 7 --- Scheduling and migration

Add placement scoring, node drain/maintenance mode, explicit migration,
verified checkpoint, checksummed transfer, atomic placement revision,
destination verification, and rollback.

## Representative API

``` text
POST   /api/mesh
POST   /api/mesh/join
POST   /api/mesh/enrollment-tokens
GET    /api/mesh/nodes
DELETE /api/mesh/nodes/{nodeId}

GET    /api/servers
POST   /api/servers
POST   /api/servers/{id}/start
POST   /api/servers/{id}/stop
POST   /api/servers/{id}/restart
POST   /api/servers/{id}/move

GET    /api/clusters
POST   /api/clusters
POST   /api/clusters/{id}/validate-storage

GET    /api/users
POST   /api/users
PATCH  /api/users/{id}

GET    /api/mesh/health
GET    /api/nodes/{id}/health
```

Adapt routes to existing project conventions.

## Required automated tests

1.  Create a three-node Mesh; verify initial and incremental
    synchronization.
2.  Create user on A; authenticate on B and C.
3.  Start a server hosted on C from A.
4.  Kill current leader; verify all ARK processes remain alive.
5.  Verify leadership recovers without game restart.
6.  Partition C; verify local management works and security writes are
    denied.
7.  Disable a user while C is partitioned; reconnect C; verify stale
    sessions invalidate.
8.  Remove a node; verify its old credentials cannot reconnect.
9.  Lose a remote command response, retry same `CommandId`, verify one
    side effect.
10. Reboot an isolated node; verify local configured servers restore.
11. Validate shared ASA storage from every cluster member.
12. Test shared storage over a private cross-network overlay.
13. Test clock skew, packet loss, latency, disk pressure, and
    storage-authority failure.

## Definition of Done --- initial Mesh release

-   Standalone installations upgrade without enabling Mesh.
-   Two or more full AASM installations securely join one Mesh.
-   Logging into any healthy node shows the Mesh-wide node/server
    inventory.
-   Authorized users manage remote servers.
-   Leader loss never stops surviving ARK servers.
-   Users/roles are Mesh-wide with no permanent central-login
    dependency.
-   Security-sensitive partition behavior is enforced.
-   ASA maps on different nodes can use a validated shared cluster path.
-   Remote commands are authenticated, authorized, audited, and
    idempotent.
-   Node removal revokes trust.
-   Windows/Linux/Docker/Unraid differences are abstracted through
    capabilities/runtime interfaces.
-   Automated tests cover leader loss, partition, reconnect, stale
    sessions, command retry, and storage failure.

## Implementation discipline

For each phase:

1.  inspect existing code before designing replacements;
2.  write/update tests first where practical;
3.  make the smallest architectural refactor needed for the phase;
4.  preserve standalone behavior;
5.  document new persisted schema/protocol changes;
6.  add migration/version handling;
7.  run unit/integration tests;
8.  report changed files, architecture decisions, remaining risks, and
    next phase.

Do not silently make a major architectural substitution. If existing
code conflicts with this specification, document the conflict and choose
the least disruptive path that preserves the non-negotiable rules.
