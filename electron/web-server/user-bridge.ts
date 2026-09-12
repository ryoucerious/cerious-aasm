/**
 * The web server child's link to the user database, which lives in the main process.
 *
 * Only one process opens the SQLite file, so credential checks are a request/response over
 * the existing Node IPC channel rather than a second connection to the same database.
 * If the main process is unreachable (tests, or the server run standalone) every check
 * resolves to null, and login falls back to the legacy single account.
 */

export interface VerifiedAccount {
  id: string;
  username: string;
  displayName: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  active: boolean;
}

const VERIFY_TIMEOUT_MS = 5000;

/**
 * Set by web-server.service when it forks this process. Without it there is no main process
 * listening for auth-verify, so asking would only stall the login.
 */
function mainProcessAvailable(): boolean {
  return process.env.AASM_USER_DB === '1' && typeof process.send === 'function';
}

let nextRequestId = 1;
const pending = new Map<string, { resolve: (account: VerifiedAccount | null) => void; timer: NodeJS.Timeout }>();

/** Ask the main process to check a username and password. */
export function verifyWithUserDatabase(username: string, password: string): Promise<VerifiedAccount | null> {
  if (typeof process === 'undefined' || !mainProcessAvailable()) {
    return Promise.resolve(null);
  }

  const requestId = `auth-${nextRequestId++}-${Date.now()}`;
  return new Promise<VerifiedAccount | null>(resolve => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      console.warn('[user-bridge] Credential check timed out; falling back to the legacy login.');
      resolve(null);
    }, VERIFY_TIMEOUT_MS);

    pending.set(requestId, { resolve, timer });
    try {
      process.send!({ type: 'auth-verify', requestId, username, password });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(requestId);
      console.error('[user-bridge] Could not reach the main process:', error);
      resolve(null);
    }
  });
}

/** Called by the IPC handler when the main process answers. */
export function resolveAuthVerify(requestId: string, account: VerifiedAccount | null): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.resolve(account);
}

/** Test hook: drop any in-flight checks. */
export function resetUserBridge(): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.resolve(null);
  }
  pending.clear();
}
