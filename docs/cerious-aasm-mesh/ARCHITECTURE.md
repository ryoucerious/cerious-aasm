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

### How desired state is kept

The hosting node writes a server's desired state. A start or stop that
succeeds there records it afterwards: a local click, Start All or Stop
All, a force stop, a restart, or a command forwarded from another node.
Start All and Stop All cover every server the user can see: servers on
other nodes go to their hosts as one `start-all` or `stop-all` command
per node, and a node that fails is reported to the user who asked.

The reconciler acts on a change of desired state, once. The first time
it sees a server placed on its node (after a restart, or a move onto the
node) it starts one that should be running. It never stops a running
server on first sight. Between changes it leaves the process alone, so
crashes, scheduled restarts and updates stay with the local policies.

Without quorum the decision is kept on the hosting node in
`mesh/desired-intents.json`. It wins over the replicated row there and
is written when quorum returns. A stop made during a partition holds,
across a restart of the app too.

### Config saves

A server's config is saved on the node that hosts it. An edit made on
another node goes there as a `save-config` command, and so does a new
server placed on another node; Auto-select picks that node before
anything is saved. No node keeps a copy of a server it does not host.
Placement changes only through a move, never through a save.

A save on the hosting node during a partition is kept: the config is on
disk, the server is listed in `mesh/pending-configs.json`, and the mesh
row is written when quorum returns. Creating a server on another node
needs quorum.

Each tick the hosting node also records any server whose config on disk
has a higher `configRevision` than its mesh row, whatever saved it: an
INI edit, an ownership change, a config import, the cluster flags the
reconciler wrote. A server imported from a backup is recorded as it is
created.

Each tick a node sets aside, in `Saved/MeshMoved`, any server directory
of its own whose server another member hosts. A server whose node has
left the mesh is kept, since that copy may be the only one.

Auto-select only considers nodes that answered a heartbeat recently and
can take `save-config`. Each node refreshes its capabilities, version
and protocol in its own row as it announces itself.

### Servers on other nodes

Every server page works the same whichever node hosts the server.

- **Reads** (state, log, player count, online players, RCON status, an
  INI file) are `POST /v1/query` to the hosting node. They are not
  commands: not logged, no quorum, only a reachable host. The host
  answers only about servers placed on it.
- **Changes** (an RCON command, connecting or disconnecting RCON, saving
  an INI file, the operator or assigned manager) are commands: `rcon`,
  `connect-rcon`, `disconnect-rcon`, `save-ini`, `set-ownership`. They
  are authorized on the node the user is on, audited, and run once per
  CommandId on the host. `set-ownership` changes only those two fields.
  A host refuses a command about a server another node hosts.
- **Live events** for a server (log lines, state, players, CPU, memory,
  RCON status) are relayed by its host over `/v1/events`. Each node keeps
  one subscription to every other member, using its node certificate,
  and shows an event only when the sender hosts the server it is about.
  A subscriber joins the broadcast list only after its certificate is
  known not to be revoked.

Each tick a node notes every server's placement and pool. The permission
gate uses it for a server with no config on this machine, so pool
restrictions apply to servers on other nodes; pool-scoped broadcasts use
it to reach the right accounts.

### Delete and move

Deleting a server removes its mesh row first, then its files. If the
files cannot be deleted the row is put back. A server hosted elsewhere is
deleted by its host through a `delete` command. A server whose host has
been removed from the mesh can only be forgotten.

A move runs as a `move` command on the node hosting the server:

``` text
Source       SaveWorld → stop → list config + saves → checksum
             → POST /v1/checkpoint/begin
             → PUT /v1/checkpoint/file, one streamed request per file
             → POST /v1/checkpoint/finish
Destination  stage in Saved/MeshIncoming → check the file list → checksum
Source       compare checksums → placement write, only if still on source
             → set its own copy aside in Saved/MeshMoved
Destination  reconciler sees the placement → promote staged files → start
```

Files are streamed, so memory use does not grow with the size of the
world. The checksum is sha256 over each relative path and its bytes, in
code-point path order, so nodes with different locales agree.

A failure before the placement write leaves the server where it was and
starts it again if it was running. After the write there is no rollback.

Once an hour each node removes staged files that nothing has written to
for 2 hours (a move that was abandoned), and copies in `Saved/MeshMoved`
set aside more than 14 days ago.

### Versions

Mesh protocol 2 adds the `delete`, `move`, `save-config`, `start-all`,
`stop-all`, `rcon`, `connect-rcon`, `disconnect-rcon`, `save-ini` and
`set-ownership` commands, `/v1/query`, the live event relay and the
streamed checkpoint. A node refuses to send one of these to a node whose
recorded protocol is older and says that node needs an update; start,
stop, restart and updates still work across versions. A protocol 2 node accepts a protocol 1 node joining
through it, but a protocol 1 node refuses a newer one, so update the node
you join through first.

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
