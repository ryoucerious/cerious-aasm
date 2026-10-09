import {
  areServerFilesUpdating,
  getInstanceState,
  getNormalizedInstanceState,
  isServerMoving,
  setInstanceState,
  whileServerFilesUpdate,
  whileServerMoves
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

  it('marks one server as being moved for exactly as long as its move runs', async () => {
    const during: boolean[] = [];

    await whileServerMoves('isle', async () => {
      during.push(isServerMoving('isle'), isServerMoving('other'));
    });

    expect(during).toEqual([true, false]);
    expect(isServerMoving('isle')).toBe(false);
  });

  it('clears the move mark when the move fails', async () => {
    await expect(whileServerMoves('isle', async () => { throw new Error('copy failed'); })).rejects.toThrow('copy failed');

    expect(isServerMoving('isle')).toBe(false);
  });
});
