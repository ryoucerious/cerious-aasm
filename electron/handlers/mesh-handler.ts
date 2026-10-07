import { identifySender } from '../services/auth/permission-gate';
import { meshService } from '../services/mesh/mesh-service';
import { ensureNodeIdentity } from '../services/runtime/node-identity';
import { onRequest } from './handler.utils';

/** The address typed in on Create or Join, if any: where the others reach this machine. */
function addressOf(payload: Record<string, unknown>): { host: unknown; peerPort: unknown; raftPort: unknown } | undefined {
  const address = payload.address as Record<string, unknown> | undefined;
  if (!address || typeof address !== 'object' || !String(address.host ?? '').trim()) return undefined;
  return { host: address.host, peerPort: address.peerPort, raftPort: address.raftPort };
}

onRequest('get-mesh-status', async () => {
  const status = await meshService.status();
  if (!status.nodeId) ensureNodeIdentity();
  return meshService.status();
});

onRequest('mesh-login', async payload => {
  const user = await meshService.loginDesktop(String(payload.username || ''), String(payload.password || ''));
  if (!user) return { success: false, error: 'Those credentials were not accepted.' };
  return { success: true, user };
});

onRequest('mesh-bootstrap-admin', async payload => {
  try {
    const user = await meshService.bootstrapAdmin(String(payload.username || ''), String(payload.password || ''));
    if (!user) return { success: false, error: 'An account already exists. Sign in with it.' };
    return { success: true, user };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not create the admin account.' };
  }
});

onRequest('mesh-logout', () => {
  meshService.logoutDesktop();
  return { success: true };
});

onRequest('create-mesh', async payload => {
  try {
    const status = await meshService.createMesh({
      name: String(payload.name || 'Mesh'),
      adminUsername: payload.adminUsername ? String(payload.adminUsername) : undefined,
      adminPassword: payload.adminPassword ? String(payload.adminPassword) : undefined,
      address: addressOf(payload)
    });
    return { success: true, status };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not create the mesh.' };
  }
});

onRequest('join-mesh', async payload => {
  try {
    const status = await meshService.joinMesh({
      memberUrl: String(payload.memberUrl || ''),
      token: String(payload.token || ''),
      name: payload.name ? String(payload.name) : undefined,
      adminUsername: payload.adminUsername ? String(payload.adminUsername) : undefined,
      adminPassword: payload.adminPassword ? String(payload.adminPassword) : undefined,
      address: addressOf(payload)
    });
    return { success: true, status };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not join the mesh.' };
  }
});

onRequest('create-enrollment-token', async () => {
  try {
    const created = await meshService.createEnrollmentToken();
    return { success: true, ...created };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not create a token.' };
  }
});

onRequest('remove-mesh-node', async payload => {
  try {
    await meshService.removeNode(String(payload.nodeId || ''));
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not remove that node.' };
  }
});

onRequest('set-node-maintenance', async payload => {
  try {
    await meshService.setMaintenance(String(payload.nodeId || ''), !!payload.maintenance);
    return { success: true, status: await meshService.status() };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not update that node.' };
  }
});

onRequest('rename-mesh-node', async payload => {
  try {
    await meshService.renameNode(String(payload.nodeId || ''), String(payload.name ?? ''));
    return { success: true, status: await meshService.status() };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not rename that machine.' };
  }
});

// Checks every other machine can reach it there first; takes up to a minute while the mesh database moves.
onRequest('set-mesh-node-address', async (payload, { sender }) => {
  const actor = identifySender(sender).user?.username || 'desktop';
  const result = await meshService.changeAddress(String(payload.nodeId || ''), {
    host: payload.host, peerPort: payload.peerPort, raftPort: payload.raftPort
  }, actor);
  return { ...result, status: await meshService.status() };
});

onRequest('suggest-placement', async () => ({ nodeId: await meshService.suggestPlacement() }));

onRequest('validate-cluster-storage', async payload => {
  const storage = await meshService.validateCluster(String(payload.clusterId || ''));
  return { success: !!storage?.health.ok, storage };
});

onRequest('move-server', async (payload, { sender }) => {
  const actor = identifySender(sender).user?.username || 'desktop';
  return meshService.move(String(payload.serverId || payload.id || ''), String(payload.nodeId || ''), actor);
});

onRequest('mesh-diagnostics', async () => ({ success: true, ...(await meshService.diagnostics()) }));

onRequest('mesh-wireguard', async () => ({ success: true, ...(await meshService.wireguardSnippet()) }));

onRequest('mesh-wireguard-apply', async () => meshService.applyWireguardOnHost());

onRequest('mesh-node-update', async (payload, { sender }) => {
  const kind = payload.kind === 'app' ? 'app' : payload.kind === 'ark' ? 'ark' : '';
  if (!kind) return { success: false, error: 'Choose an ARK update or an app update.' };
  const actor = identifySender(sender).user?.username || 'desktop';
  const result = await meshService.requestNodeUpdate(String(payload.nodeId || ''), kind, actor);
  if (!result.success) return result;
  const detail = result.detail as { version?: string } | undefined;
  if (kind === 'ark') {
    const minutes = (result.detail as { warningMinutes?: number } | undefined)?.warningMinutes ?? 0;
    return {
      ...result,
      message: minutes > 0
        ? `That machine downloads the update while its servers keep running. Once it is ready, players are warned for ${minutes} minutes, then its servers stop, the new files go in, and they start again.`
        : 'That machine is downloading the ARK update. None of its servers were running.'
    };
  }
  const version = detail?.version ? ` to ${detail.version}` : '';
  return {
    ...result,
    message: `App update started${version}. A Docker node replaces the app files and restarts the app process. The container stays up. Update one voting node at a time.`
  };
});

onRequest('backup-mesh', async payload => {
  try {
    await meshService.backupTo(String(payload.dest || ''));
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Backup failed.' };
  }
});

onRequest('get-mesh-audit', async () => {
  const status = await meshService.status();
  return { success: true, enabled: status.enabled, events: await meshService.audit() };
});
