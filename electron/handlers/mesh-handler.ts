import { identifySender } from '../services/auth/permission-gate';
import { meshService } from '../services/mesh/mesh-service';
import { ensureNodeIdentity } from '../services/runtime/node-identity';
import { onRequest } from './handler.utils';

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
      adminPassword: payload.adminPassword ? String(payload.adminPassword) : undefined
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
      adminPassword: payload.adminPassword ? String(payload.adminPassword) : undefined
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

onRequest('suggest-placement', async () => ({ nodeId: await meshService.suggestPlacement() }));

onRequest('create-cluster', async payload => {
  try {
    const cluster = await meshService.createCluster({
      name: String(payload.name || ''),
      arkClusterId: String(payload.arkClusterId || payload.name || ''),
      members: Array.isArray(payload.members) ? payload.members.map(String) : [],
      path: payload.path ? String(payload.path) : undefined
    });
    return { success: true, cluster };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not create that cluster.' };
  }
});

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
    return { ...result, message: 'ARK update started. That machine stops its servers, updates the install, then starts them again.' };
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
