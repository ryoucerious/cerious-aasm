import { messagingService } from '../services/messaging.service';
import { platformService } from '../services/platform.service';
import {
  sampleCpuTimes,
  cpuPercentFromSamples,
  getTotalMemory,
  getFreeMemory,
  getDiskUsage
} from '../utils/platform.utils';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Handles the 'get-host-resources' message: overall CPU, memory and disk usage of the machine
 * the servers run on, for the dashboard's System Resources panel.
 *
 * CPU is measured over a short window because os.cpus() only exposes cumulative counters.
 * Disk is measured on the volume holding the app's config directory, which is where server
 * data lives by default. Any value that cannot be determined comes back as null so the UI can
 * show a placeholder rather than a misleading zero.
 */
messagingService.on('get-host-resources', async (payload: any, sender: any) => {
  const { requestId } = payload || {};
  try {
    const first = sampleCpuTimes();
    await delay(250);
    const second = sampleCpuTimes();
    const cpuPercent = cpuPercentFromSamples(first, second);

    const totalMemory = getTotalMemory();
    const freeMemory = getFreeMemory();
    const usedMemory = Math.max(0, totalMemory - freeMemory);

    let diskPath = '';
    try {
      diskPath = platformService.getConfigPath();
    } catch {
      diskPath = '';
    }
    const disk = getDiskUsage(diskPath);

    messagingService.sendToOriginator('get-host-resources', {
      cpuPercent,
      memory: { used: usedMemory, total: totalMemory },
      disk: disk ? { used: Math.max(0, disk.total - disk.free), total: disk.total } : null,
      requestId
    }, sender);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[host-resources-handler] Failed to read host resources:', errMsg);
    messagingService.sendToOriginator('get-host-resources', { error: errMsg, requestId }, sender);
  }
});
