import { COMMAND_SKEW_MS } from '../../types/mesh.types';

/** True when a command's timestamps sit outside the allowed skew window. */
export function clockSkewRejects(issuedAt: number, expiry: number, now = Date.now(), skewMs = COMMAND_SKEW_MS): boolean {
  return issuedAt > now + skewMs || expiry < now - skewMs;
}

/** A dropped packet is not a Raft entry and does not stop a game process. */
export function packetDelivered(loss: boolean): boolean {
  return !loss;
}

export function withLatency(baseMs: number, extraMs: number): number {
  return Math.max(0, baseMs) + Math.max(0, extraMs);
}

/** Placement refuses a node whose free disk is under the floor. Existing servers stay where they are. */
export function diskAllowsPlacement(freeBytes: number, floorBytes: number): boolean {
  return freeBytes >= floorBytes;
}
