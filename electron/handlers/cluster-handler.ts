import { onRequest } from './handler.utils';
import { messagingService } from '../services/messaging.service';
import { meshService } from '../services/mesh/mesh-service';
import { localRuntime } from '../services/runtime/local-runtime';
import { createLocalCluster, knownClusters, removeLocalCluster, renameLocalCluster } from '../services/clusters/cluster-registry';

/**
 * Settings → Clusters. In a mesh the mesh defines the clusters and keeps their transfer files on
 * every machine; on a machine on its own they are kept here. Each server chooses its cluster in
 * its own settings (clusterRef).
 */

function failure(error: unknown, fallback: string): { success: false; error: string } {
  return { success: false, error: error instanceof Error ? error.message : fallback };
}

/** Every screen asks again; in a mesh the other machines hear it through mesh-status. */
function changed(): void {
  messagingService.sendToAll('clusters-changed', {});
}

onRequest('get-clusters', async () => ({
  success: true,
  clusters: meshService.isEnabled() ? await meshService.listClusters() : knownClusters()
}));

onRequest('create-cluster', async payload => {
  try {
    const input = { name: String(payload.name ?? ''), arkClusterId: String(payload.arkClusterId ?? '') };
    const cluster = meshService.isEnabled() ? await meshService.createCluster(input) : createLocalCluster(input);
    changed();
    return { success: true, cluster };
  } catch (error) {
    return failure(error, 'Could not create that cluster.');
  }
});

onRequest('rename-cluster', async payload => {
  try {
    const clusterId = String(payload.clusterId ?? '');
    const name = String(payload.name ?? '');
    const cluster = meshService.isEnabled() ? await meshService.renameCluster(clusterId, name) : renameLocalCluster(clusterId, name);
    changed();
    return { success: true, cluster };
  } catch (error) {
    return failure(error, 'Could not rename that cluster.');
  }
});

onRequest('delete-cluster', async payload => {
  try {
    const clusterId = String(payload.clusterId ?? '');
    if (meshService.isEnabled()) {
      await meshService.deleteCluster(clusterId);
    } else {
      removeLocalCluster(clusterId);
      // Out of the cluster at their next start; the transfer files stay in its folder.
      const { instances } = await localRuntime.listInstances();
      for (const instance of instances) {
        if (instance.clusterRef === clusterId) await localRuntime.patchConfig(instance.id, { clusterRef: null });
      }
    }
    changed();
    return { success: true };
  } catch (error) {
    return failure(error, 'Could not remove that cluster.');
  }
});
