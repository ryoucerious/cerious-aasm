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

/** Placement and ownership of every server the mesh knows, as of the last reconcile tick. */
export interface MeshServerSummary {
  serverId: string;
  nodeId: string;
  operatorUserId: string | null;
  managerUserId: string | null;
}

let meshServerList = new Map<string, MeshServerSummary>();
const meshServerListeners = new Set<() => void>();

const signInListeners = new Set<(required: boolean) => void>();
let member = false;

export function registerMeshAuth(next: MeshAuthApi | null): void {
  auth = next;
  if (!next) {
    securityVersions.clear();
    noteMeshServers([]);
  }
}

/**
 * Set from the moment this node knows it belongs to a mesh, before it reaches the others after a
 * restart, until it leaves. Stopping the app leaves it set.
 */
export function setMeshMember(next: boolean): void {
  if (member === next) return;
  member = next;
  for (const listener of signInListeners) listener(next);
}

/**
 * True while this node is in a mesh. Its web interface then controls servers on every node, so
 * a web client needs a mesh account even where this machine's own login is off.
 */
export function meshSignInRequired(): boolean {
  return member;
}

/** Hears when this node joins or leaves a mesh. Returns a function that stops listening. */
export function onMeshSignInChanged(listener: (required: boolean) => void): () => void {
  signInListeners.add(listener);
  return () => signInListeners.delete(listener);
}

/**
 * The permission gate and the broadcast scoping are synchronous; they read servers hosted on
 * other nodes from here. Listeners hear about a change, not about every tick.
 */
export function noteMeshServers(servers: MeshServerSummary[]): void {
  const next = new Map(servers.map(server => [server.serverId, { ...server }]));
  const same = next.size === meshServerList.size && [...next].every(([id, server]) => {
    const before = meshServerList.get(id);
    return !!before && before.nodeId === server.nodeId && before.operatorUserId === server.operatorUserId
      && before.managerUserId === server.managerUserId;
  });
  meshServerList = next;
  if (!same) for (const listener of meshServerListeners) listener();
}

export function meshServer(serverId: string): MeshServerSummary | null {
  return meshServerList.get(serverId) ?? null;
}

export function meshServers(): MeshServerSummary[] {
  return [...meshServerList.values()];
}

export function onMeshServersChanged(listener: () => void): void {
  meshServerListeners.add(listener);
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
