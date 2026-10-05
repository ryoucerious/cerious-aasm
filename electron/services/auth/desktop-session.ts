import type { SenderIdentity } from './permission-gate';

/**
 * Standalone desktop stays the implicit local admin. Once a mesh is joined, the desktop
 * window is a mesh user and has to sign in, the same as the web UI.
 */
let meshMode = false;
let current: SenderIdentity | null = null;

export function setMeshDesktopMode(enabled: boolean): void {
  meshMode = enabled;
  if (!enabled) current = null;
}

export function setMeshDesktopUser(identity: SenderIdentity | null): void {
  current = identity;
}

/** `'standalone'` leaves identifySender on the local-admin path. */
export function meshDesktopIdentity(): SenderIdentity | 'standalone' {
  if (!meshMode) return 'standalone';
  return current ?? { user: null, permissions: [], isAdmin: false, isLocalDesktop: true };
}
