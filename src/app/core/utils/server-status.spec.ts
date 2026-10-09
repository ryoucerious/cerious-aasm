import {
  serverStatusKey, serverStatusLabel, serverStatusClass,
  isOnlineStatus, isBusyStatus, canStartStatus
} from './server-status';

describe('server-status', () => {
  it('normalises both the backend keys and the humanised page copy', () => {
    expect(serverStatusKey('running')).toBe('running');
    expect(serverStatusKey('Running')).toBe('running');
    expect(serverStatusKey('Preparing to start')).toBe('queued');
    expect(serverStatusKey('queued')).toBe('queued');
    expect(serverStatusKey('CRASHED')).toBe('crashed');
  });

  it('treats missing and unknown states as offline', () => {
    expect(serverStatusKey(undefined)).toBe('stopped');
    expect(serverStatusKey(null)).toBe('stopped');
    expect(serverStatusKey('')).toBe('stopped');
    expect(serverStatusKey('unknown')).toBe('stopped');
    expect(serverStatusKey('something else')).toBe('stopped');
  });

  it('speaks in Online and Offline', () => {
    expect(serverStatusLabel('running')).toBe('Online');
    expect(serverStatusLabel('stopped')).toBe('Offline');
    expect(serverStatusLabel(undefined)).toBe('Offline');
    expect(serverStatusLabel('starting')).toBe('Starting');
    expect(serverStatusLabel('Preparing to start')).toBe('Queued');
    expect(serverStatusLabel('stopping')).toBe('Stopping');
    expect(serverStatusLabel('crashed')).toBe('Crashed');
    expect(serverStatusLabel('error')).toBe('Error');
  });

  // A server on a mesh machine that has stopped answering: its last known state may be stale.
  it('says when the machine running a server cannot be reached, and offers nothing to do with it', () => {
    expect(serverStatusKey('unreachable')).toBe('unreachable');
    expect(serverStatusLabel('unreachable')).toBe('Unreachable');
    expect(serverStatusClass('unreachable')).toBe('status-unreachable');
    expect(isOnlineStatus('unreachable')).toBeFalse();
    expect(isBusyStatus('unreachable')).toBeFalse();
    expect(canStartStatus('unreachable')).toBeFalse();
  });

  it('maps to the existing status css classes', () => {
    expect(serverStatusClass('running')).toBe('status-running');
    expect(serverStatusClass('queued')).toBe('status-starting');
    expect(serverStatusClass('crashed')).toBe('status-error');
    expect(serverStatusClass(undefined)).toBe('status-stopped');
  });

  it('answers the lifecycle questions', () => {
    expect(isOnlineStatus('Running')).toBeTrue();
    expect(isOnlineStatus('stopped')).toBeFalse();

    expect(isBusyStatus('running')).toBeTrue();
    expect(isBusyStatus('starting')).toBeTrue();
    expect(isBusyStatus('Preparing to start')).toBeTrue();
    expect(isBusyStatus('stopping')).toBeTrue();
    expect(isBusyStatus('stopped')).toBeFalse();
    expect(isBusyStatus('crashed')).toBeFalse();

    expect(canStartStatus('stopped')).toBeTrue();
    expect(canStartStatus('crashed')).toBeTrue();
    expect(canStartStatus('error')).toBeTrue();
    expect(canStartStatus('running')).toBeFalse();
    expect(canStartStatus('stopping')).toBeFalse();
  });
});
