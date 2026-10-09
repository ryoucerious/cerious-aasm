jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('path');
jest.unmock('node:path');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../../utils/platform.utils', () => ({ getDefaultInstallDir: jest.fn(), getPlatform: jest.fn(() => 'windows') }));

import { getDefaultInstallDir } from '../../utils/platform.utils';
import { clusterFolder, rememberClusters } from './cluster-registry';
import { carryClusterData } from './cluster-import';

describe('carrying a server\'s transfer data into the cluster it joins', () => {
  const PLAYER = '0002a1b2c3d4e5f60718293a4b5c6d7e';
  let root: string;
  let instanceDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-cluster-import-'));
    jest.mocked(getDefaultInstallDir).mockReturnValue(root);
    instanceDir = path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'Servers', 'isle');
    fs.mkdirSync(instanceDir, { recursive: true });
    rememberClusters([{ clusterId: 'c1', name: 'Islands', arkClusterId: 'Islands' }]);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function upload(base: string, clusterId: string, contents: string): void {
    fs.mkdirSync(path.join(base, 'clusters', clusterId), { recursive: true });
    fs.writeFileSync(path.join(base, 'clusters', clusterId, PLAYER), contents);
  }

  function inCluster(): string | null {
    const file = path.join(clusterFolder('c1'), 'clusters', 'Islands', PLAYER);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }

  it('brings what players uploaded under the server\'s own cluster ID, from ARK\'s default folder', () => {
    upload(path.join(instanceDir, 'ShooterGame', 'Saved'), 'OldCluster', 'dino');

    carryClusterData({ id: 'isle', clusterRef: 'c1', clusterId: 'OldCluster' }, { instanceDir, runtimeRoot: instanceDir });

    expect(inCluster()).toBe('dino');
  });

  it('brings it from the folder the server named for itself', () => {
    upload(path.join(root, 'MyClusters'), 'OldCluster', 'dino');

    carryClusterData({ id: 'isle', clusterRef: 'c1', clusterId: 'OldCluster', clusterDirOverride: 'MyClusters' }, { instanceDir, runtimeRoot: instanceDir });

    expect(inCluster()).toBe('dino');
  });

  it('brings it once, so a file the cluster later lost is not brought back', () => {
    upload(path.join(instanceDir, 'ShooterGame', 'Saved'), 'OldCluster', 'dino');
    const instance = { id: 'isle', clusterRef: 'c1', clusterId: 'OldCluster' };
    carryClusterData(instance, { instanceDir, runtimeRoot: instanceDir });
    fs.rmSync(path.join(clusterFolder('c1'), 'clusters', 'Islands', PLAYER));

    carryClusterData(instance, { instanceDir, runtimeRoot: instanceDir });

    expect(inCluster()).toBeNull();
  });

  // Downloaded in the first cluster, it would be there to download again in the next.
  it('brings it into one cluster only, when the server later moves on to another', () => {
    rememberClusters([
      { clusterId: 'c1', name: 'Islands', arkClusterId: 'Islands' },
      { clusterId: 'c2', name: 'Wilds', arkClusterId: 'Wilds' }
    ]);
    upload(path.join(instanceDir, 'ShooterGame', 'Saved'), 'OldCluster', 'dino');
    carryClusterData({ id: 'isle', clusterRef: 'c1', clusterId: 'OldCluster' }, { instanceDir, runtimeRoot: instanceDir });

    carryClusterData({ id: 'isle', clusterRef: 'c2', clusterId: 'OldCluster' }, { instanceDir, runtimeRoot: instanceDir });

    expect(inCluster()).toBe('dino');
    expect(fs.existsSync(path.join(clusterFolder('c2'), 'clusters', 'Wilds', PLAYER))).toBe(false);
  });

  // Its folder, uploads and all, goes with it; on the new machine the same uploads sit at another path.
  it('does not bring it again after the server moves to another machine', () => {
    upload(path.join(instanceDir, 'ShooterGame', 'Saved'), 'OldCluster', 'dino');
    const instance = { id: 'isle', clusterRef: 'c1', clusterId: 'OldCluster' };
    carryClusterData(instance, { instanceDir, runtimeRoot: instanceDir });
    fs.rmSync(path.join(clusterFolder('c1'), 'clusters', 'Islands', PLAYER));
    const moved = path.join(root, 'elsewhere', 'isle');
    fs.cpSync(instanceDir, moved, { recursive: true });

    carryClusterData(instance, { instanceDir: moved, runtimeRoot: moved });

    expect(inCluster()).toBeNull();
  });

  it('leaves alone what the cluster already holds for a player', () => {
    upload(path.join(instanceDir, 'ShooterGame', 'Saved'), 'OldCluster', 'old dino');
    upload(clusterFolder('c1'), 'Islands', 'newer dino');

    carryClusterData({ id: 'isle', clusterRef: 'c1', clusterId: 'OldCluster' }, { instanceDir, runtimeRoot: instanceDir });

    expect(inCluster()).toBe('newer dino');
  });

  it('does nothing for a server in no cluster, one with no ID of its own before, or a cluster this machine does not know', () => {
    upload(path.join(instanceDir, 'ShooterGame', 'Saved'), 'OldCluster', 'dino');

    carryClusterData({ id: 'isle', clusterId: 'OldCluster' }, { instanceDir, runtimeRoot: instanceDir });
    carryClusterData({ id: 'isle', clusterRef: 'c1' }, { instanceDir, runtimeRoot: instanceDir });
    carryClusterData({ id: 'isle', clusterRef: 'gone', clusterId: 'OldCluster' }, { instanceDir, runtimeRoot: instanceDir });

    expect(inCluster()).toBeNull();
    expect(fs.readdirSync(instanceDir)).toEqual(['ShooterGame']);
  });

  it('never stops the server starting', () => {
    upload(path.join(instanceDir, 'ShooterGame', 'Saved'), 'OldCluster', 'dino');
    fs.mkdirSync(path.join(clusterFolder('c1'), 'clusters'), { recursive: true });
    fs.writeFileSync(path.join(clusterFolder('c1'), 'clusters', 'Islands'), 'a file where a folder belongs');

    expect(() => carryClusterData({ id: 'isle', clusterRef: 'c1', clusterId: 'OldCluster' }, { instanceDir, runtimeRoot: instanceDir })).not.toThrow();
  });
});
