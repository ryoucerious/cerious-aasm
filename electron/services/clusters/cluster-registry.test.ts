jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('path');
jest.unmock('node:path');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../../utils/platform.utils', () => ({ getDefaultInstallDir: jest.fn(), getPlatform: jest.fn(() => 'windows') }));

import { getDefaultInstallDir } from '../../utils/platform.utils';

type Registry = typeof import('./cluster-registry');

describe('cluster registry', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-clusters-'));
    jest.mocked(getDefaultInstallDir).mockReturnValue(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** A fresh copy of the module, as after a restart. */
  function load(): Registry {
    let registry!: Registry;
    jest.isolateModules(() => { registry = require('./cluster-registry'); });
    return registry;
  }

  it('remembers the clusters this machine knows across a restart', () => {
    load().rememberClusters([{ clusterId: 'c1', name: 'Islands', arkClusterId: 'Islands' }]);

    expect(load().knownClusters()).toEqual([{ clusterId: 'c1', name: 'Islands', arkClusterId: 'Islands' }]);
    expect(load().knownCluster('c1')?.name).toBe('Islands');
    expect(load().knownCluster('nope')).toBeNull();
  });

  it('knows no clusters on a machine that never had one', () => {
    expect(load().knownClusters()).toEqual([]);
  });

  // A server stores only which cluster it is in; each machine, Windows, Linux or Docker, works out
  // its own folder for it, so a moved server finds that machine's copy.
  it('keeps each cluster\'s files in its own folder beside this machine\'s server data', () => {
    expect(load().clusterFolder('c1')).toBe(path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'AASMClusters', 'c1'));
  });

  describe('on a machine on its own', () => {
    it('creates, renames and removes clusters', () => {
      const registry = load();

      const created = registry.createLocalCluster({ name: ' Islands ', arkClusterId: 'Islands' });
      expect(created).toEqual({ clusterId: expect.any(String), name: 'Islands', arkClusterId: 'Islands' });

      registry.renameLocalCluster(created.clusterId, 'Isles');
      expect(load().knownCluster(created.clusterId)?.name).toBe('Isles');

      load().removeLocalCluster(created.clusterId);
      expect(load().knownClusters()).toEqual([]);
    });

    it('refuses a name or ID that cannot be used, and an ID another cluster has', () => {
      const registry = load();
      registry.createLocalCluster({ name: 'Islands', arkClusterId: 'Islands' });

      expect(() => registry.createLocalCluster({ name: ' ', arkClusterId: 'Other' })).toThrow('Enter a name for the cluster.');
      expect(() => registry.createLocalCluster({ name: 'Other', arkClusterId: 'my cluster' })).toThrow('A cluster ID can use letters');
      expect(() => registry.createLocalCluster({ name: 'Other', arkClusterId: '../up' })).toThrow('A cluster ID can use letters');
      expect(() => registry.createLocalCluster({ name: 'Other', arkClusterId: 'Islands' })).toThrow('Another cluster already uses the ID Islands.');
    });

    it('says when there is no such cluster', () => {
      expect(() => load().renameLocalCluster('nope', 'X')).toThrow('That cluster was not found.');
      expect(() => load().removeLocalCluster('nope')).toThrow('That cluster was not found.');
    });
  });
});
