export type PartitionOp =
  | 'login'
  | 'local-server'
  | 'security-write'
  | 'enroll'
  | 'remove-node'
  | 'placement'
  | 'remote-command'
  | 'read';

const PAUSED = 'Mesh is partitioned. Security and membership changes are paused until this node can see a quorum.';

/**
 * While this node cannot reach a Raft quorum it may still authenticate from its local
 * replica and operate servers placed here. It must not write security, membership or placement.
 */
export function partitionDecision(
  hasQuorum: boolean,
  operation: PartitionOp,
  serverPlacedHere = false
): { allow: boolean; reason?: string } {
  if (hasQuorum) return { allow: true };
  if (operation === 'read' || operation === 'login') return { allow: true };
  if (operation === 'local-server' && serverPlacedHere) return { allow: true };
  return { allow: false, reason: PAUSED };
}
