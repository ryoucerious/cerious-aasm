import { platformService } from '../services/platform.service';
import {
  sampleCpuTimes,
  cpuPercentFromSamples,
  getTotalMemory,
  getFreeMemory,
  getDiskUsage
} from '../utils/platform.utils';
import { onRequest } from './handler.utils';

// os.cpus() only has cumulative counters, so CPU is the difference over this window.
const CPU_SAMPLE_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * CPU, memory and disk of the machine the servers run on. Disk is the volume holding the config
 * directory, where server data lives by default. A value that cannot be read is null, so the UI
 * shows a placeholder rather than a misleading zero.
 */
onRequest('get-host-resources', async () => {
  const first = sampleCpuTimes();
  await delay(CPU_SAMPLE_MS);
  const cpuPercent = cpuPercentFromSamples(first, sampleCpuTimes());

  const totalMemory = getTotalMemory();
  const usedMemory = Math.max(0, totalMemory - getFreeMemory());

  let diskPath = '';
  try {
    diskPath = platformService.getConfigPath();
  } catch {
    // getDiskUsage('') measures the home directory's volume instead.
  }
  const disk = await getDiskUsage(diskPath);

  return {
    cpuPercent,
    memory: { used: usedMemory, total: totalMemory },
    disk: disk ? { used: Math.max(0, disk.total - disk.free), total: disk.total } : null
  };
}, { onError: error => ({ error }) });
