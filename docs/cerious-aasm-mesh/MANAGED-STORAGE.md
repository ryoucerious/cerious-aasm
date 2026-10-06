# AASM Managed Transfer Storage

Status: implemented as `ClusterSync` in `electron/services/mesh/cluster-sync.ts`. Every cluster created in Settings → Clusters while in a mesh uses it. Shared-path storage profiles still validate as before, but nothing in the UI creates them any more.

A player can upload a character, items or dinos on a server on one machine and download them on a server on another, with the machines on different networks and no shared folder. The app keeps each cluster's transfer files on every machine, over the mesh's own mTLS connection. It is not a generic folder synchronizer.

## What ASA writes

ASA keeps a cluster's transfers at `<ClusterDirOverride>/clusters/<ClusterId>/<player id>`: one file per player, rewritten on each upload and download. A file means something only once the server has finished writing it. A copy taken mid-write, or an old copy brought back after a download emptied it, would roll back or duplicate a transfer.

## Where the files are

Each machine keeps a cluster at `AASMServer/ShooterGame/Saved/AASMClusters/<cluster id>` in its data folder, next to the `Servers` folder that holds its servers (in Docker, inside the data volume). Every server of the cluster on that machine starts with `-ClusterDirOverride=` that folder and `-ClusterId=` the cluster's ARK ID. Different operating systems need different paths, and the app chooses them per machine, so nobody types a path.

The machine's own working state is in `mesh/cluster-sync/`: `state.json` (what it last had of each file), `objects/` (content-addressed copies it can serve) and `conflicts/` (copies set aside).

## Rules

1. **Finished writes only.** A changed file counts once two looks in a row, 2 seconds apart, see the same size and SHA-256. A file being written is never recorded or sent. A file that disappears counts as deleted only when it is still gone at the next look.
2. **Commit through Raft.** The mesh database holds one row per file in `cluster_files`: version, SHA-256, size, deleted, and the machine it came from. A machine commits a change with compare-and-set on the version it last had. The row only changes if nobody else changed it first, so there is no authority node: whichever commit Raft orders first wins. Without quorum nothing is committed, the change waits on that machine, and game servers keep running.
3. **Same contents are not a clash.** A machine whose file already matches the recorded hash just adopts that version.
4. **The first change wins; the other is set aside.** When two machines change one player's file at once, the commit that loses keeps nothing. Its local copy goes to `conflicts/<cluster>/<path>.<time>`, and the winner's version is placed. Nothing is merged or silently dropped. The Settings → Clusters page shows how many copies each machine set aside.
5. **Tombstones.** A deletion is a version like any other. A machine that was away applies it and does not bring the file back.
6. **Verified, atomic placement.** A machine fetches a version it lacks with `GET /v1/cluster-object?sha256=` from the machine that recorded it, or from any other that has it. It checks the hash, writes a temporary `.aasm-sync-` file beside the destination and renames it into place. ARK never sees a partial file. A copy whose hash does not match is refused.
7. **Prompt, then periodic.** A machine that commits a change announces it with a `cluster-changed` event, and the others look straight away. Every machine also looks every 2 seconds.

## Recovery

- **A machine unreachable for a while:** when it is back, it fetches what changed and applies deletions. A change it made while away is committed against the version it last had. If someone else changed that file in the meantime, its copy is set aside.
- **No quorum:** local changes wait and are committed once quorum returns. Recorded versions keep being placed.
- **Interrupted fetch or placement:** the temporary file is discarded, and the next pass tries again from the committed record.
- **Restart:** `state.json` remembers what this machine had, so nothing is re-sent and no file is mistaken for a new change.

## Status

Each machine's heartbeat carries a summary per cluster: files in step, changes waiting to be recorded, versions waiting to be fetched, copies set aside, and the last error. `get-mesh-status` returns it as `nodes[].clusterSync`, and Settings → Clusters shows it per machine.

## Joining, leaving, and earlier data

- **Create or join a mesh:** this machine's own clusters go into the mesh once. If the mesh already has a cluster with the same ARK ID, this machine's servers are pointed at it instead and their transfer files are copied into its folder.
- **Leaving:** the machine keeps a copy of the mesh's clusters in `data/clusters.json`, so its servers stay in them on their own.
- **A server that had its own cluster ID:** when it first starts in a cluster, what players uploaded under that ID is copied into the cluster, only for files the cluster does not have yet. This happens once per source folder, even if the server later moves to another cluster or another machine, so the same uploads cannot be downloaded twice. The original folder is left as it was.
