// ark-server-state.utils.test.ts
// Unit tests for ARK server state management

const stateUtils = require('./ark-server-state.utils');

describe('ark-server-state.utils', () => {
  beforeEach(() => {
    // Clear instanceStates and arkServerProcesses before each test
    Object.keys(stateUtils.arkServerProcesses).forEach(k => delete stateUtils.arkServerProcesses[k]);
    // Clear instanceStates by setting known keys to undefined
    stateUtils.setInstanceState('id1', undefined);
    stateUtils.setInstanceState('id2', undefined);
  });

  describe('setInstanceState & getInstanceState', () => {
    it('sets and gets instance state', () => {
      stateUtils.setInstanceState('id1', 'running');
      expect(stateUtils.getInstanceState('id1')).toBe('running');
    });
    it('returns null for unknown instance', () => {
      expect(stateUtils.getInstanceState('unknown')).toBeNull();
    });
  });

  describe('getNormalizedInstanceState', () => {
    it('returns actual state if set', () => {
      stateUtils.setInstanceState('id2', 'starting');
      expect(stateUtils.getNormalizedInstanceState('id2')).toBe('starting');
    });
    it('returns "stopped" for unknown or null state', () => {
      expect(stateUtils.getNormalizedInstanceState('unknown')).toBe('stopped');
      stateUtils.setInstanceState('id2', null);
      expect(stateUtils.getNormalizedInstanceState('id2')).toBe('stopped');
    });
  });

  describe('arkServerProcesses', () => {
    it('can store and clear process objects', () => {
      const fakeProc = { pid: 123, kill: jest.fn() };
      stateUtils.arkServerProcesses['id3'] = fakeProc;
      expect(stateUtils.arkServerProcesses['id3']).toBe(fakeProc);
      delete stateUtils.arkServerProcesses['id3'];
      expect(stateUtils.arkServerProcesses['id3']).toBeUndefined();
    });
  });
});
