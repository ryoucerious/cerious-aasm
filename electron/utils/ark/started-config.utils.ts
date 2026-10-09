import * as fs from 'fs';
import * as path from 'path';
import { getInstanceDir } from './instance.utils';
import { writeJsonAtomic } from '../fs.utils';
import type { InstanceConfig } from '../../types/server-instance.types';

/**
 * The settings a server started with, kept beside its config.json. Settings can be saved while it
 * runs; they take effect at its next start, and the settings page marks the ones that differ.
 */
const FILE = 'started-config.json';

/** Live figures that come and go with the process, not settings. */
const RUNTIME_FIELDS = ['state', 'status', 'players', 'memory', 'cpu', 'startedAt'] as const;

export function recordStartedConfig(instanceId: string, config: InstanceConfig): void {
  const kept: Record<string, unknown> = { ...config };
  for (const field of RUNTIME_FIELDS) delete kept[field];
  try {
    writeJsonAtomic(path.join(getInstanceDir(instanceId), FILE), kept);
  } catch (error) {
    console.warn(`[started-config] Could not keep the settings ${instanceId} started with:`, error instanceof Error ? error.message : error);
  }
}

/** The settings the server last started with, or null when it has not started since this was kept. */
export function readStartedConfig(instanceId: string): InstanceConfig | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(getInstanceDir(instanceId), FILE), 'utf8')) as InstanceConfig;
  } catch {
    return null;
  }
}

/**
 * What RCON connects with: the port and password the server started with, which it keeps until it
 * restarts, though new ones may be saved meanwhile.
 */
export function forRcon<T extends Partial<InstanceConfig> & { id: string }>(current: T): T {
  const started = readStartedConfig(current.id);
  if (!started) return current;
  return { ...current, rconPort: started.rconPort, rconPassword: started.rconPassword, serverAdminPassword: started.serverAdminPassword };
}
