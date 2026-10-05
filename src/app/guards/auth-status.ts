/**
 * Whether the web UI may be used now: the server wants no sign-in, or we have one.
 * False when the server cannot be reached.
 */
export async function hasWebAccess(): Promise<boolean> {
  try {
    // HTTP rather than the message bus: right after signing in the WebSocket is still
    // reconnecting, and a question sent over it failed and bounced the user back to login.
    const response = await fetch('/api/auth-status', { credentials: 'include' });
    if (!response.ok) return false;

    const data = await response.json();
    // Only an explicit "no sign-in needed" lets someone through without a session; a reply
    // missing the field is treated as needing one.
    return data?.requiresAuth === false || !!data?.authenticated;
  } catch {
    return false;
  }
}
