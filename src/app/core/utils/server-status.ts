/**
 * One vocabulary for a server's state across the whole UI.
 *
 * The backend reports lowercase keys ('running', 'stopped', …) while the server page keeps a
 * humanised copy on its working instance ('Running', 'Preparing to start'), so {@link serverStatusKey}
 * accepts either form. Everything the user reads comes from {@link serverStatusLabel}, which
 * speaks in Online/Offline rather than Running/Stopped.
 *
 * Keep this separate from ServerStateService.mapServerState: that mapping feeds logic which
 * compares against 'Running', and changing its words would change behaviour.
 */

export type ServerStatusKey =
  | 'running' | 'stopped' | 'starting' | 'queued' | 'stopping' | 'crashed' | 'error';

const LABELS: Record<ServerStatusKey, string> = {
  running: 'Online',
  stopped: 'Offline',
  starting: 'Starting',
  queued: 'Queued',
  stopping: 'Stopping',
  crashed: 'Crashed',
  error: 'Error'
};

const CSS_CLASSES: Record<ServerStatusKey, string> = {
  running: 'status-running',
  stopped: 'status-stopped',
  starting: 'status-starting',
  queued: 'status-starting',
  stopping: 'status-stopping',
  crashed: 'status-error',
  error: 'status-error'
};

/** Material icon shown beside the status, e.g. in a server list. */
const ICONS: Record<ServerStatusKey, string> = {
  running: 'play_circle_filled',
  stopped: 'stop_circle',
  starting: 'hourglass_empty',
  queued: 'schedule',
  stopping: 'pause_circle_filled',
  crashed: 'error',
  error: 'error'
};

/** Normalise any spelling of a state to one key. Anything unrecognised counts as offline. */
export function serverStatusKey(state: string | null | undefined): ServerStatusKey {
  const value = (state || '').trim().toLowerCase();
  switch (value) {
    case 'running': return 'running';
    case 'starting': return 'starting';
    case 'queued':
    case 'preparing to start': return 'queued';
    case 'stopping': return 'stopping';
    case 'crashed': return 'crashed';
    case 'error': return 'error';
    case 'stopped':
    case '':
    case 'unknown':
    default: return 'stopped';
  }
}

/** The words shown to the user: Online, Offline, Starting, Queued, Stopping, Crashed, Error. */
export function serverStatusLabel(state: string | null | undefined): string {
  return LABELS[serverStatusKey(state)];
}

export function serverStatusClass(state: string | null | undefined): string {
  return CSS_CLASSES[serverStatusKey(state)];
}

export function serverStatusIcon(state: string | null | undefined): string {
  return ICONS[serverStatusKey(state)];
}

/** Online. */
export function isOnlineStatus(state: string | null | undefined): boolean {
  return serverStatusKey(state) === 'running';
}

/** Online or moving between states; edits and deletes are blocked here. */
export function isBusyStatus(state: string | null | undefined): boolean {
  const key = serverStatusKey(state);
  return key === 'running' || key === 'starting' || key === 'queued' || key === 'stopping';
}

/** Stopped, crashed or errored: a start is possible. */
export function canStartStatus(state: string | null | undefined): boolean {
  const key = serverStatusKey(state);
  return key === 'stopped' || key === 'crashed' || key === 'error';
}
