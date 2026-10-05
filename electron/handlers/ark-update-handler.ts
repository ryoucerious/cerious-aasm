import { ArkUpdateService } from '../services/ark-update.service';
import { isArkServerInstalled } from '../utils/ark/ark-install.utils';
import { getArkServerDir } from '../utils/ark/ark-server/ark-server-paths.utils';
import { onRequest } from './handler.utils';

let arkUpdateService: ArkUpdateService | null = null;

export function setArkUpdateService(service: ArkUpdateService): void {
  arkUpdateService = service;
}

onRequest('get-ark-installation', async () => {
  const installed = isArkServerInstalled();
  // Re-read the installed build through the service so the build shown and the update flag
  // come from one comparison. Straight after an install the disk has the new build while the
  // last poll still says an update is pending.
  const status = arkUpdateService ? await arkUpdateService.refreshInstalledBuild() : null;
  return {
    success: true,
    installed,
    installedBuildId: status?.installedBuildId ?? null,
    latestBuildId: status?.latestBuildId ?? null,
    updateAvailable: !!status?.updateAvailable,
    lastCheckedAt: status?.lastCheckedAt ?? null,
    installPath: getArkServerDir()
  };
});

onRequest('check-ark-update', async () => {
  if (!arkUpdateService) {
    console.error('[ark-update-handler] ArkUpdateService not initialized');
    return { success: false, error: 'Update service not initialized' };
  }
  const { success, hasUpdate, buildId, message, error } = await arkUpdateService.checkForUpdate();
  return { success, hasUpdate, buildId, message, error };
});
