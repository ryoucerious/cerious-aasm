# Cerious-AASM Mesh

## Architecture & Implementation Specification

Build Cerious-AASM Mesh so every participating machine runs the full
application, any healthy node can manage the entire Mesh, and loss of
the current leader never stops healthy ARK: Survival Ascended servers.

## Non-negotiable rules

1.  Every node runs the full Cerious-AASM application.
2.  ARK lifecycle supervision remains local to the hosting node.
3.  There is no permanent main node; leadership is movable.
4.  Users, roles, permissions, membership, server inventory, and cluster
    definitions are Mesh-wide state.
5.  Known users can authenticate locally; login must not require one
    central machine.
6.  Security/membership writes are restricted during partitions without
    authoritative state.
7.  ASA transfer storage is independent from control-plane leadership.
8.  Do not use naive eventual folder synchronization for ASA transfer
    data.
9.  Remote commands are authenticated, authorized, audited, and
    idempotent.
10. Standalone AASM remains supported.

## Documents

-   `ARCHITECTURE.md` --- complete technical design.
-   `AGENT-IMPLEMENTATION.md` --- implementation phases, tests,
    constraints, and Definition of Done.

## Topology

``` text
                         CERIOUS-AASM MESH
+------------------------------------------------------------------+
| Shared logical state: identity, nodes, servers, clusters, policy |
+-----------------------------+------------------------------------+
                              |
                    mTLS / replicated state
              /                |                 \
+------------------+ +------------------+ +------------------+
| Node A           | | Node B           | | Node C           |
| Current Leader   | | Follower         | | Follower         |
| Full AASM UI/API | | Full AASM UI/API | | Full AASM UI/API |
| Local Runtime    | | Local Runtime    | | Local Runtime    |
+--------+---------+ +--------+---------+ +--------+---------+
         |                    |                    |
   Island / SE          Aberration            Extinction
```

## Required build order

1.  Refactor local runtime boundaries.
2.  Stable Mesh/Node/Server/Cluster IDs and persistence boundaries.
3.  Secure node enrollment and authenticated transport.
4.  Registry, health, capabilities, remote commands, global inventory.
5.  Mesh identity, RBAC, sessions, audit.
6.  Offline/degraded behavior.
7.  HA replicated control plane and leader election.
8.  Logical ASA clusters and validated shared-path transfer storage.
9.  Cross-network overlay integration.
10. Purpose-built AASM Managed Transfer Storage.
11. Scheduling, drain mode, server migration.

## Machines on different networks

Every member connects to every other member on two TCP ports:

| What | Default port |
| --- | --- |
| Peer API: status, commands, moves, cluster files | 4747 |
| Mesh database (Raft) | 4002 |

For a member outside the others' network:

1. Forward both TCP ports to the machine on its router, in both directions: each side's router forwards to its own machine. A VPN such as Tailscale or WireGuard avoids port forwarding.
2. Tell the mesh the address the others should dial: the public IP address or a dynamic DNS name. Use the outside ports when the router forwards different ones to 4747 and 4002.
   - Joining: under "How other machines reach this one" in Settings → Mesh, choose **Use another address** before **Join mesh**. Do the same before **Create mesh** when the first machine is the one others reach from outside.
   - Already a member: **Change address** in the ⋯ menu on its card in Settings → Mesh. Every other member first checks it can reach the machine there; nothing changes if one cannot.
3. Machines on the same network as each other then also reach each other by that public address. That needs the router to support NAT loopback (hairpinning). If it does not, use a dynamic DNS name that resolves to the LAN address inside the network, or a VPN.

Ports 4001 (the local database API) and 3000 (the web interface) are not part of the mesh, and need no forwarding for it.
