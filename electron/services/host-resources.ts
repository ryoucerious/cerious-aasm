import type { NodeResources } from '../types/mesh.types';
import {
  sampleCpuTimes,
  cpuPercentFromSamples,
  getTotalMemory,
  getFreeMemory,
  getDiskUsage
} from '../utils/platform.utils';
import { platformService } from './platform.service';

// os.cpus() only has cumulative counters, so CPU is the difference over this window.
const CPU_SAMPLE_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * CPU, memory and disk of the machine the servers run on. Disk is the volume holding the config
 * directory, where server data lives by default. A disk that cannot be read is null, so the UI
 * shows a placeholder rather than a misleading zero. The dashboard asks for this, and a mesh node
 * sends it with each heartbeat.
 */
export async function sampleHostResources(): Promise<NodeResources> {
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
}
