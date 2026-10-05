import {
  areServerFilesUpdating,
  getInstanceState,
  getNormalizedInstanceState,
  setInstanceState,
  whileServerFilesUpdate
} from './ark-server-state.utils';

describe('ark-server-state.utils', () => {
  it('sets and gets instance state', () => {
    setInstanceState('id1', 'running');
    expect(getInstanceState('id1')).toBe('running');
  });

  it('returns null for an unknown instance', () => {
    expect(getInstanceState('unknown')).toBeNull();
  });

  it('normalizes a state that was never set to stopped', () => {
    setInstanceState('id2', 'starting');
    expect(getNormalizedInstanceState('id2')).toBe('starting');
    expect(getNormalizedInstanceState('unknown')).toBe('stopped');
  });

  it('marks the server files as being updated for exactly as long as the work runs', async () => {
    let during = false;

    await expect(whileServerFilesUpdate(async () => {
      during = areServerFilesUpdating();
      return 'done';
    })).resolves.toBe('done');

    expect(during).toBe(true);
    expect(areServerFilesUpdating()).toBe(false);
  });

  it('clears the mark when the work fails', async () => {
    await expect(whileServerFilesUpdate(async () => { throw new Error('SteamCMD failed'); })).rejects.toThrow('SteamCMD failed');

    expect(areServerFilesUpdating()).toBe(false);
  });
});
