# Cerious-AASM Mesh --- Technical Architecture

## Application

Use one application/codebase.

``` text
Cerious-AASM
├── UI / API
├── Local Runtime
│   ├── Server Manager
│   ├── Process/Container Supervisor
│   ├── SteamCMD / Updates
│   ├── RCON / Backups / Local Scheduler
└── Mesh Module
    ├── Node Identity / Enrollment
    ├── Peer Transport / Heartbeat
    ├── Replicated State / Leader Coordination
    ├── Command Router
    ├── Identity / RBAC
    ├── ASA Cluster Manager / Storage Providers
    └── Audit
```

A node may host games, be leader-eligible, both, or neither. Mesh is
opt-in and standalone behavior must remain supported.

## Game plane and control plane

The **game plane** is local authority: process/container lifecycle,
watchdog, RCON, SteamCMD, backups, saves, paths, restart policy, and
local schedules. It must not require the leader.

The **control plane** coordinates node registry, global inventory,
desired state, placement, cluster definitions, identity, remote
commands, audit, and scheduling.

### Failure contract

  -----------------------------------------------------------------------
  Failure                             Required behavior
  ----------------------------------- -----------------------------------
  Leader stops                        Surviving ARK servers continue;
                                      another eligible node may lead.

  Mesh transport fails                Every node continues supervising
                                      local servers.

  WAN fails                           Remote coordination degrades; local
                                      management remains available.

  Node is isolated                    Local servers continue; permitted
                                      local operations remain usable.

  Isolated node reboots               It restores configured local
                                      servers without another node.

  Transfer storage fails              Game servers continue; transfers
                                      may degrade.
  -----------------------------------------------------------------------

## Leadership

No permanent master exists. Leadership is a replaceable control-plane
role.

Leader responsibilities: serialize authoritative Mesh mutations,
coordinate membership/security changes, maintain replicated-state
progression, and coordinate cross-node operations.

Leader must not own remote ARK lifetimes, remote watchdogs, the only
identity copy, the only bootable remote configuration, or the only ASA
transfer data.

Use a proven consensus/replication implementation where practical.

## Server state

Every server has stable `ServerId`; `NodeId` is placement.

``` text
Mesh DesiredState = RUNNING
        ↓
Hosting-node reconciler
        ├── healthy → no-op
        ├── stopped → start exactly once
        ├── crashed → local restart policy
        └── config changed → stage/apply
```

Mesh owns desired state, placement, desired configuration revision, and
ASA cluster membership. Hosting node owns actual PID/container, runtime
metrics, applied config, and local save/runtime state.

## Enrollment and transport

Enrollment uses a short-lived one-time token. The joining node generates
asymmetric identity, joins through a known member, receives stable
`NodeId`, trust information, and initial state snapshot. Thereafter use
mTLS or equivalent mutual identity. Removing a node revokes its
credential.

Recommended channels:

-   HTTPS/gRPC over mTLS for commands.
-   SignalR/WebSocket or streaming gRPC for realtime events.
-   Dedicated replication/consensus transport.
-   HTTPS UI/API on every node.
-   Separate ASA transfer-storage path/protocol.

Remote commands include `CommandId`, correlation ID, actor, target,
operation, expiry, and expected revision. Repeating a `CommandId` must
not repeat the side effect.

Different networks should use a private routable overlay. Add
WireGuard-style assistance later; keep AASM protocol independent from
the VPN. Never recommend public SMB/NFS exposure.

## Mesh identity

Users belong to the Mesh. Replicate password verifiers and security
metadata, never plaintext passwords. Prefer Argon2id.

Suggested user fields:

``` text
UserId, Username, PasswordHash, PasswordParameters,
Enabled, SecurityVersion, MfaState, CreatedAt, UpdatedAt
```

A node authenticates from its replicated identity state. Do not require
every login to call the leader.

Increment `SecurityVersion` when password, MFA, enabled state, roles,
scoped permissions, or security/session reset changes. Tokens carry the
observed version and become invalid when stale.

### RBAC

Use capabilities, not hard-coded role names:

``` text
nodes.view/enroll/manage/remove
servers.view/create/start/stop/restart/configure/delete/move
clusters.view/manage/storage.manage
rcon.view/execute/admin
backups.view/create/restore/delete
users.view/create/manage/disable
roles.manage
mesh.view/configure/security.manage
```

Support Mesh-wide and resource-scoped grants. Authorization is
server-side and default-deny.

### Partition behavior

While isolated, allow cached known-user authentication and authorized
local server operations. Mark remote state stale. Deny
user/role/security mutations, node enrollment/removal, and cross-node
placement changes. Show **Mesh Degraded**. Catch up authoritative
security state before sensitive writes resume.

## ASA clusters

A logical ASA cluster may span nodes:

``` text
The Island       → Node A
Scorched Earth   → Node A
Aberration       → Node B
Extinction       → Node C
```

All members share the ARK cluster identifier and compatible storage
profile.

### Transfer storage

Control leadership and storage authority are separate roles. Losing
either must not stop game processes.

First production implementation: shared SMB/NFS/appropriate filesystem,
optionally over a private overlay. Validate reachability, read/write
access, atomic rename behavior, directory identity, latency, and
required semantics from every cluster member.

Future AASM Managed Storage must **not** be generic eventual folder
sync. It must detect completed writes, commit objects with
hash/size/version, require durable acknowledgement, expose only
committed data, atomically materialize destination files, track
consumption/deletion with versions or tombstones, prevent stale
resurrection, checksum transfers, and define
duplicate/interruption/authority-failure recovery.

## Models

Use stable UUIDs.

``` text
Mesh: MeshId, Name, SchemaVersion, SecurityEpoch
Node: NodeId, MeshId, Name, Identity, Endpoints, Capabilities,
      LeaderEligible, Status, LastSeen, Version, ProtocolVersion
Server: ServerId, Name, NodeId, Map, RuntimeType, Ports,
        ClusterId, DesiredState, ConfigRevision
AsaCluster: ClusterId, Name, ArkClusterId, StorageProfileId, Members
User: UserId, Username, PasswordHash, PasswordParameters,
      Enabled, SecurityVersion
Role: RoleId, Name, PermissionSet, SecurityVersion
StorageProfile: StorageProfileId, Mode, AuthorityNodeId, metadata
AuditEvent: EventId, Timestamp, Actor, NodeId, Action,
            Resource, Result, CorrelationId
```

High-frequency telemetry is eventually consistent and must not be forced
through consensus.

## Service boundaries

``` text
IMeshMembershipService
IMeshReplicationService
INodeTransport
INodeRuntime
ICommandRouter
IIdentityService
IAuthorizationService
IServerRegistry
IClusterService
IClusterStorageProvider
IAuditService
```

## UI

The Mesh feels like one AASM installation. Show global Mesh health,
Nodes, all Servers with Node filtering, logical ASA Clusters with
storage health, Mesh-wide Users/Roles, a Join Mesh wizard, node
selection/Auto-select during server creation, and explicit
degraded/stale indicators.

Future placement may score free RAM, CPU, disk, I/O, capabilities,
storage/network reachability, node weight, ASA load, and maintenance
state. Never automatically migrate a healthy server unless explicitly
enabled.

## Control-plane restore

ARK world saves are not part of this restore. Game processes are left
running.

1. Stop AASM on the node being restored. That stops its local `rqlited`.
   It does not stop ARK processes on other nodes.
2. Replace that node's `mesh/rqlite/` directory with a mesh backup
   (`backup-mesh` writes the rqlite snapshot). Leave `mesh/node.key` in
   place. The node private key is not in the backup.
3. Start AASM again. It rejoins using the Raft address of a member that
   still has quorum, then catches up.
4. If the backup is the only remaining copy, start that node alone so it
   can elect itself, then join the others to it.

A leadership change during this procedure is not a desired-state change
and must not start or stop ARK.
