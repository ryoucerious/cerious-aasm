import type { AuthenticatedUser } from '../../types/auth.types';

/**
 * Narrow hooks so the web server and the permission gate can ask the mesh a question
 * without importing the mesh service (that import would cycle through the message bus).
 */
export type MeshWriteOp = 'security-write' | 'enroll' | 'remove-node' | 'placement' | 'remote-command';

export interface MeshAuthApi {
  enabled(): boolean;
  verify(username: string, password: string): Promise<AuthenticatedUser | null>;
  resolve(userId: string): Promise<{ user: AuthenticatedUser; securityVersion: number } | null>;
  hasQuorum(): boolean;
}

let auth: MeshAuthApi | null = null;
let writeBlock: (op: MeshWriteOp) => string | null = () => null;
const securityVersions = new Map<string, number>();

export function registerMeshAuth(next: MeshAuthApi | null): void {
  auth = next;
  if (!next) securityVersions.clear();
}

/** Current replicated security version. A session issued below this is stale. */
export function noteSecurityVersion(userId: string, version: number): void {
  securityVersions.set(userId, version);
}

export function securityVersionStale(userId: string, issued: number | undefined): boolean {
  if (issued == null || !Number.isFinite(issued)) return false;
  const current = securityVersions.get(userId);
  return current != null && issued < current;
}

export function meshAuth(): MeshAuthApi | null {
  return auth;
}

export function setMeshWriteBlock(next: (op: MeshWriteOp) => string | null): void {
  writeBlock = next;
}

/** A sentence the handler can return, or null when the write is allowed. */
export function meshWriteBlock(op: MeshWriteOp): string | null {
  return writeBlock(op);
}
