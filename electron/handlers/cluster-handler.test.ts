import { messagingService } from '../services/messaging.service';
import { meshService } from '../services/mesh/mesh-service';
import * as registry from '../services/clusters/cluster-registry';
import { localRuntime } from '../services/runtime/local-runtime';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn(), sendToAll: jest.fn() }
}));
jest.mock('../services/mesh/mesh-service', () => ({
  meshService: {
    isEnabled: jest.fn(() => false),
    listClusters: jest.fn(async () => []),
    createCluster: jest.fn(),
    renameCluster: jest.fn(),
    deleteCluster: jest.fn(),
    setUploadNotices: jest.fn()
  }
}));
jest.mock('../services/clusters/cluster-registry', () => ({
  knownClusters: jest.fn(() => []),
  createLocalCluster: jest.fn(),
  renameLocalCluster: jest.fn(),
  removeLocalCluster: jest.fn()
}));
jest.mock('../services/runtime/local-runtime', () => ({
  localRuntime: { listInstances: jest.fn(async () => ({ instances: [] })), patchConfig: jest.fn(async () => ({})) }
}));

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('cluster-handler', () => {
  const sender = { send: jest.fn() };
  const islands = { clusterId: 'c1', name: 'Islands', arkClusterId: 'Islands' };

  const handlers = new Map<string, Listener>();

  beforeAll(() => {
    require('./cluster-handler');
    for (const [name, listener] of jest.mocked(messagingService.on).mock.calls) handlers.set(name as string, listener as Listener);
  });

  function handler(channel: string): Listener {
    return handlers.get(channel)!;
  }

  async function ask(channel: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    jest.mocked(messagingService.sendToOriginator).mockClear();
    await handler(channel)({ requestId: 'r1', ...payload }, sender);
    return jest.mocked(messagingService.sendToOriginator).mock.calls[0][1] as Record<string, unknown>;
  }

  describe('on a machine on its own', () => {
    beforeEach(() => jest.mocked(meshService.isEnabled).mockReturnValue(false));

    it('lists the clusters kept here', async () => {
      jest.mocked(registry.knownClusters).mockReturnValue([islands]);

      expect(await ask('get-clusters')).toMatchObject({ success: true, clusters: [islands] });
    });

    it('creates, renames and removes clusters here, and tells every screen', async () => {
      jest.mocked(registry.createLocalCluster).mockReturnValue(islands);

      expect(await ask('create-cluster', { name: 'Islands', arkClusterId: 'Islands' })).toMatchObject({ success: true, cluster: islands });
      await ask('rename-cluster', { clusterId: 'c1', name: 'Isles' });
      await ask('delete-cluster', { clusterId: 'c1' });

      expect(registry.createLocalCluster).toHaveBeenCalledWith({ name: 'Islands', arkClusterId: 'Islands' });
      expect(registry.renameLocalCluster).toHaveBeenCalledWith('c1', 'Isles');
      expect(registry.removeLocalCluster).toHaveBeenCalledWith('c1');
      expect(messagingService.sendToAll).toHaveBeenCalledWith('clusters-changed', {});
    });

    it('takes this machine\'s servers out of a cluster it removes', async () => {
      jest.mocked(localRuntime.listInstances).mockResolvedValue({ instances: [{ id: 'a', clusterRef: 'c1' }, { id: 'b', clusterRef: 'c2' }] } as never);

      await ask('delete-cluster', { clusterId: 'c1' });

      expect(localRuntime.patchConfig).toHaveBeenCalledWith('a', { clusterRef: null });
      expect(localRuntime.patchConfig).not.toHaveBeenCalledWith('b', expect.anything());
    });

    it('says why a cluster could not be made', async () => {
      jest.mocked(registry.createLocalCluster).mockImplementation(() => { throw new Error('Another cluster already uses the ID Islands.'); });

      expect(await ask('create-cluster', { name: 'Islands', arkClusterId: 'Islands' }))
        .toMatchObject({ success: false, error: 'Another cluster already uses the ID Islands.' });
    });
  });

  describe('in a mesh', () => {
    beforeEach(() => jest.mocked(meshService.isEnabled).mockReturnValue(true));

    it('lists, creates, renames and removes the mesh\'s clusters', async () => {
      jest.mocked(meshService.listClusters).mockResolvedValue([islands] as never);
      jest.mocked(meshService.createCluster).mockResolvedValue(islands as never);

      expect(await ask('get-clusters')).toMatchObject({ success: true, clusters: [islands] });
      expect(await ask('create-cluster', { name: 'Islands', arkClusterId: 'Islands' })).toMatchObject({ success: true });
      await ask('rename-cluster', { clusterId: 'c1', name: 'Isles' });
      await ask('delete-cluster', { clusterId: 'c1' });

      expect(meshService.createCluster).toHaveBeenCalledWith({ name: 'Islands', arkClusterId: 'Islands' });
      expect(meshService.renameCluster).toHaveBeenCalledWith('c1', 'Isles');
      expect(meshService.deleteCluster).toHaveBeenCalledWith('c1');
      expect(registry.createLocalCluster).not.toHaveBeenCalled();
    });

    it('turns telling players their upload is ready on or off for a cluster', async () => {
      expect(await ask('set-cluster-upload-notices', { clusterId: 'c1', enabled: false })).toMatchObject({ success: true });

      expect(meshService.setUploadNotices).toHaveBeenCalledWith('c1', false);
      expect(messagingService.sendToAll).toHaveBeenCalledWith('clusters-changed', {});
    });
  });

  // On one machine every server of a cluster reads the same folder: there is nothing to wait for.
  it('has no upload notices outside a mesh', async () => {
    jest.mocked(meshService.isEnabled).mockReturnValue(false);

    expect(await ask('set-cluster-upload-notices', { clusterId: 'c1', enabled: true })).toMatchObject({ success: false });
    expect(meshService.setUploadNotices).not.toHaveBeenCalled();
  });
});
