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

A move runs as a `move` command on the node hosting the server. Only a
server that is off moves: the host refuses one that is running, starting,
stopping or queued, and the UI (the card's "Move to…" and the server
page's Move) offers it only then. While the files are copied the host
refuses any start of that server, from the UI, another node, the
reconciler or automation, and a second move of it. The server arrives
off: the placement write sets its desired state to stopped.

``` text
Source       check it is off and not already moving → mark it moving
             → list config + saves → checksum
             → POST /v1/checkpoint/begin { resume: true }
Destination  keep what is staged in Saved/MeshIncoming; answer with each
             staged file's size and sha256
Source       skip a file held whole; carry on one held in part, when what
             is held is the start of ours; send the rest from the start
             → PUT /v1/checkpoint/file?offset=N, one streamed request per file
             → POST /v1/checkpoint/finish
Destination  drop staged files the move does not list → check the file
             list → checksum
Source       compare checksums → placement write (desired: stopped), only
             if still on source → set its own copy aside in Saved/MeshMoved
Destination  reconciler sees the placement → promote staged files
```

Files are streamed, so memory use does not grow with the size of the
world. The checksum is sha256 over each relative path and its bytes, in
code-point path order, so nodes with different locales agree. A resumed
move is checked the same way as a fresh one.

A failure before the placement write leaves the server where it was, off,
and what arrived stays staged: moving again carries on from there. A file
that fails to send (no answer, a dropped connection, 409 when the
destination's copy changed, or a fault on the destination) is tried again
after 2, 5 and 15 seconds, carrying on from where the destination's copy
then ends; a refusal is not retried. After the placement write there is
no rollback.

While it runs, the host broadcasts `server-move-progress` (preparing,
checking, copying with bytes done of the total and what was already
there, verifying), at most twice a second. It is scoped like the other
per-server channels and relayed to the other nodes, so the move dialog
shows it wherever it was opened.

An older destination wipes its staging at begin and does not say what
it holds, so the source sends everything from the start, as before.

Once an hour each node removes staged files that nothing has written to
for a day (a move that was abandoned), and copies in `Saved/MeshMoved`
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

### How this build does it

Two TCP ports carry everything between members: the peer API (4747) and
Raft (4002). Both use mutual TLS with node certificates signed by the
mesh CA. rqlite's HTTP API (4001) listens on loopback only; nodes never
use it to reach each other. A proxy in front of 4747 or 4002 must pass
TLS through as raw TCP; one that ends TLS removes the certificates.

- **Join tokens name the CA.** A token is `<secret>.<fingerprint>`, the
  fingerprint being sha256 of the mesh CA certificate. The joining node
  fetches the member's CA (`GET /v1/ca`), refuses a mismatch, and sends
  the token only over a connection that trusts that CA alone. If the
  join cannot finish, it asks the member to take it back out
  (`POST /v1/abort-join`, with its new certificate).
- **Only members' certificates are trusted.** The peer API accepts a
  certificate when the member its common name names is recorded with
  exactly that serial and is not removed or revoked. A certificate
  minted with the CA key for anyone else is refused.
- **Removing another node rotates the database password.** It is taken
  out of Raft first, then a new password is written to the replicated
  `meta` table, so it never sees it; rqlite refuses joins with the old
  one. Every member restarts its rqlited with the new password on its
  next tick, since rqlited reads credentials only at start. Writes
  forwarded between members can fail for those few seconds. A node
  leaving on its own does not rotate it.
- **Advertised addresses can differ from listen ports.** A node listens
  on `AASM_PEER_PORT` and `AASM_RAFT_PORT` and tells others to dial
  `AASM_ADVERTISE_PEER_URL` and `AASM_ADVERTISE_RAFT_ADDR` (defaults:
  `AASM_ADVERTISE_HOST` with those ports), or an address typed in on
  Create or Join. They are read when the node creates or joins a mesh
  and kept; its certificate covers their hosts.
- **A member can change its address while it stays in the mesh**
  (Settings → Mesh, Change address; `set-address` command). It is done
  on the member itself, with quorum:
  1. Every other member that can be asked TLS-probes the new peer and
     Raft endpoints and must find this member's certificate (CN = node
     id) on both. If one cannot, nothing changes and the error names
     it. A member that cannot be asked at all is skipped and named.
  2. The member re-signs its certificate for the old and new hosts,
     presents it (`setSecureContext`), and records the new endpoints
     and serial. Members keep dialing the old address until they read
     the new one.
  3. rqlited restarts under the new `-raft-adv-addr` with `-join`
     through the other members' Raft addresses, and the leader replaces
     its record. A member alone rewrites its own membership with
     `raft/peers.json`. If the database does not list it at the new
     address in time, it goes back to the old one.

The mesh CA key is in the replicated state, so every member can enroll
a node. A removed node may still hold it, which the rules above make
insufficient: it cannot reach the database, rejoin Raft, or be trusted
on the peer API.

The web interface is separate. Behind a reverse proxy, `AASM_TRUST_PROXY`
names the proxies whose `X-Forwarded-*` headers it believes.

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

### How accounts are kept

The mesh's `users` and `roles` tables are the accounts. Each node keeps
its own account database as a mirror of them, refreshed on every tick
it changes, so the Users page, pools and lookups on any node see every
account. Creating, editing or deleting an account on any node writes
that node's database, then the mesh (quorum required); the others follow
within a tick. An account made or changed in the last minute is not
undone by the mirror while its copy to the mesh is under way.

- Logins check the mesh row: Argon2id, or bcrypt for accounts made on
  one machine, upgraded to Argon2id at the first login. A hash is
  labelled by what it is.
- `SecurityVersion` rises for a new password, enabling or disabling, a
  new role or a new pool; a display name change or the hash upgrade
  signs no one out.
- Deleting an account or a custom role removes it from the mesh, so its
  name can be used again. Built-in roles are the same everywhere.
- When a machine joins a mesh, the mesh's accounts replace the ones it
  had; those are kept in `mesh/accounts-before-join-<time>.db`.
- The joining machine's own admin password comes with it, as a numbered
  machine admin for that machine: `admin<N>-<site>-<machine>`, where
  the site is its name in the mesh and the machine its host name (left
  out in a container). The password is the one it was started with
  (`--password` or `AASM_PASSWORD`), else its oldest active admin
  account, else its single web login, carried as the stored hash. The
  join reports the name, and the mesh page shows it. A member that
  joined before this existed does the same once, at its first check
  with quorum, from the copy it kept when it joined
  (`mesh/carried-login.json` records that it has). Nothing is added
  when the mesh already has that password or a machine admin for the
  machine, and an account a mesh admin deletes is not brought back.
- An account set from the command line stays local to its machine.
- Every member's web interface and desktop window require sign-in,
  from the moment the app starts until the machine leaves, whatever its
  own login setting: they control servers on every node. Membership is
  read from the identity file before the web server or the window
  starts, and the web server is started with sign-in already on. Only
  mesh accounts sign in: the machine's single web login is not in force
  in a mesh, whether its own setting is on or off, and a session of it
  is signed out. (It used to stay in force where the setting was on, as
  an admin of every machine; a machine whose accounts were its way in
  was locked out instead.) Leaving the mesh puts that login back; the
  saved setting is never changed.
- While a member reconnects after a restart, logins are checked against
  its own copy of the mesh accounts, so it is never locked out. An
  account set from the command line is not a mesh account and does not
  sign in on a member.
- The UI shows a loading page, and nothing of the app, until access is
  confirmed: the desktop until it knows who is signed in, the web UI
  until the server accepts its socket. A sign-in becoming necessary
  hides the app at once.

### Machine names

A member is named by its identity file when it is first made: the host
name, or `AASM_NODE_NAME`, since a container's host name is its
container id. Anyone with `nodes.manage` can rename any member from the
mesh page; the name is stored in the mesh, and the renamed machine
keeps it in its identity file for when it joins a mesh again. The
sidebar shows the machine each server runs on.

### Live state of servers on other nodes

The node hosting a server broadcasts its state, log, players, CPU and
memory, and relays them to every member over `/v1/events`. A start
made by a remote command or by the reconciler broadcasts like a start
from the UI; a later stop reports through the callbacks that start
registered. A running state carries the process start time, so every
node shows the same uptime. Each node keeps what a host last reported
about its servers, so a page opened later lists them as the host does;
a stop clears uptime, players, CPU and memory. While a host sends no
heartbeat (the same rule as Unreachable on its card), its servers are
listed as Unreachable, with no uptime, players, CPU or memory, and none
of them can be started, stopped, moved or deleted from another machine.
They show what the host reports again as soon as it is heard from.

Each heartbeat carries the sender's CPU, memory and disk. The node is
the one its certificate names, whatever the body says. Mesh status
lists every member with these and the host other nodes reach it at,
which the dashboard uses for each member's resources and for a
server's join address and memory total.

### Restarting a member

Before its first snapshot, a restarted node's copy of the mesh is
empty until a leader replays the log to it, and in a mesh of two that
leader needs the restarted node's vote. So rqlited keeps running while
the copy is empty; the node looks again every 5 s and attaches once it
is filled in. Mesh status says it is reconnecting meanwhile, never
standalone, so the mesh page does not offer to create or join one.

### RBAC

Admin is the mesh admin. Only an admin brings a machine in or takes one
out: `nodes.enroll` and `nodes.remove` count for no other role, even a
custom role that lists them.

Machine Admin is a built-in role a level above Operator, for one mesh
machine. Only an admin makes one, picks its machine, and may let it
update every machine. A machine admin:

- sees every server in the mesh, in every pool;
- runs, configures, backs up and deletes the servers on its machine,
  and adds servers there (whatever machine the page asked for);
- moves any server between machines;
- updates ARK and the app on its machine, and on every machine when it
  was let;
- changes nothing else about another machine: installing, firewall
  setup, auto-start and adding a server from a backup there are refused.
  Start All and Stop All cover only the servers on its machine;
- manages no accounts, and no machine (rename, drain, address).

Its machine is in the mesh's `machine_admins` table (schema 3), apart
from `users`, so a node on an older version reads its accounts as
before; there it is a custom role without the machine limits until it
updates. A change of machine or of the update grant signs it out.

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

### Removing machines without quorum

Removing a machine is a change to the Raft membership, so it needs a
majority of the current members, as every other change does. While too
few can be reached, a machine that cannot be reached can be **forced
out** instead (`nodes.remove`): every machine that stays and can be
reached first agrees to the new member list, then each restarts its
rqlited with it (rqlite's `peers.json`). A machine that will not agree,
because it still reaches one of those machines, still has quorum, or is
not in the list, or that does not answer, leaves everything as it was.
The ones that stay and can be reached must be a majority of the new list.
A machine that stays but cannot be reached takes the new list from the
others when it is back. Then the removal finishes as Remove does: marked
removed, its certificate revoked, a new database password.

A machine forced out that comes back is refused by every member it
reaches; its mesh page then says the others removed it and offers Leave.
**Leave anyway** makes any machine standalone without the others'
agreement; they still count it until they remove it. Either way its
servers and its copy of the accounts stay.

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

Clusters are defined in Settings → Clusters: a name, and the ARK
cluster ID, which is fixed once the cluster is created. A mesh can hold
any number of them. Each server chooses one with `clusterRef` on its
Cluster tab. At launch the server gets the cluster's ARK ID and this
machine's folder for it,
`AASMServer/ShooterGame/Saved/AASMClusters/<cluster id>`, next to
the `Servers` folder. The
folder is chosen per machine, so Windows, Linux and Docker members need
no matching paths.

Outside a mesh, clusters live in `data/clusters.json`. In a mesh they
live in the mesh database, and each machine keeps a copy in that file,
so its servers start in their cluster even while the mesh cannot be
reached. Creating or joining a mesh brings this machine's clusters
into it.

### Transfer storage

The app keeps each cluster's transfer files on every machine itself,
over the mesh's mTLS peer API. No shared folder or VPN is needed. See
[MANAGED-STORAGE.md](MANAGED-STORAGE.md). In short:

- Only finished writes are recorded.
- Commits are compare-and-set through Raft. The first change wins and
  a clashing copy is set aside, never merged or silently lost.
- Tombstones stop a deleted transfer from coming back.
- Copies are fetched by hash, verified, and placed with a rename.

Losing quorum delays new commits but never stops game processes.

Shared-path storage profiles (SMB/NFS) from earlier versions still
validate through `validate-cluster-storage`.

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
