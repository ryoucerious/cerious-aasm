# AASM Managed Transfer Storage

Status: design for the provider implemented behind `ClusterStorageProvider`. Shared-path storage remains available. This store is not a folder synchronizer.

## What ASA writes

A cluster directory receives player, item, and creature transfer files. A file is only meaningful after the dedicated server finishes writing it. A reader that copies a partial file, or that resurrects a file the cluster has already consumed, duplicates or rolls back a transfer.

## Rules

1. **Completed-write detection.** A path is pending until two observations in a row report the same size and SHA-256. Pending bytes are not visible to other members.
2. **Commit.** A commit record stores the key, hash, size, and a monotonic version. The object becomes visible only after that record is durable. A second commit of the same hash and size returns the existing version.
3. **Materialization.** Members write a temp file in the destination directory and rename it into place. Readers never see a partial file.
4. **Consumption.** Deleting or consuming a transfer appends a tombstone version. A replica that catches up later applies the tombstone and does not recreate the file.
5. **Duplicates and interruption.** Re-delivery of a committed hash is a no-op. A transfer that stops before commit stays pending and is invisible.
6. **Authority.** `storage_profiles.authority_node_id` is independent of the Raft leader. If the authority is unavailable, commits fail and the cluster is marked degraded. Game processes are not stopped.
7. **Checksums.** The hash in the commit record is checked again at materialization time.

## Recovery

- Authority loss: members keep serving the last committed versions and refuse new commits until an authority is recorded again.
- Replica promotion: a member with the committed set can be named the new authority. It does not invent versions below the highest committed version it holds.
- Interrupted materialization: the temp file is discarded. The commit record is still the source of truth and materialization is retried.

The in-process implementation of these rules is `ManagedTransferStore` and `materializeAtomic` in `electron/services/mesh/managed-storage.ts`.
