import {
  serverStatusKey, serverStatusLabel, serverStatusClass, serverStatusIcon,
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

  it('maps to the existing status css classes', () => {
    expect(serverStatusClass('running')).toBe('status-running');
    expect(serverStatusClass('queued')).toBe('status-starting');
    expect(serverStatusClass('crashed')).toBe('status-error');
    expect(serverStatusClass(undefined)).toBe('status-stopped');
    expect(serverStatusIcon('running')).toBe('play_circle_filled');
    expect(serverStatusIcon(undefined)).toBe('stop_circle');
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
