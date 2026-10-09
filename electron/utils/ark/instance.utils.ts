import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getDefaultInstallDir } from '../platform.utils';
import { loadGlobalConfig } from '../global-config.utils';
import { validateInstanceId } from '../validation.utils';
import { writeJsonAtomic } from '../fs.utils';
import { findPortConflict, nextFreePortsIn, portsOutsideRanges, type PortCarrier, type PortSet, type ServerPortRanges } from './port-sets';
import { getServerPortRanges } from '../server-ports.utils';
import { notifyInstancesChanged } from './instance-changes';
import type { InstanceConfig } from '../../types/server-instance.types';

// Live values that server-management.getAllInstances merges into each instance. The UI sends
// the merged object back on save, so they are dropped before config.json is written.
const RUNTIME_FIELDS = ['state', 'status', 'players', 'memory', 'cpu', 'startedAt'] as const;

type SaveOutcome = (InstanceConfig & { error?: undefined }) | { error: string; id?: undefined };

export function getInstancesBaseDir(): string {
  const root = loadGlobalConfig().serverDataDir || getDefaultInstallDir();
  if (!root) {
    throw new Error('Could not determine install directory');
  }
  return path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'Servers');
}

/** Absolute directory for an instance. Throws if `id` fails validateInstanceId or escapes the base dir. */
export function getInstanceDir(id: string): string {
  if (!validateInstanceId(id)) {
    throw new Error(`Invalid instance ID format: ${id}`);
  }
  const baseDir = getInstancesBaseDir();
  const dir = path.resolve(baseDir, id);
  // Defence in depth: the id pattern already rules out dots and separators.
  const relative = path.relative(baseDir, dir);
  if (!relative || relative.split(path.sep)[0] === '..' || path.isAbsolute(relative)) {
    throw new Error(`Instance directory for ${id} escapes ${baseDir}`);
  }
  return dir;
}

function getInstanceConfigPath(id: string): string {
  return path.join(getInstanceDir(id), 'config.json');
}

// Notepad and PowerShell 5 save UTF-8 with a byte order mark, which JSON.parse rejects. The
// parser's message can quote the file, passwords included, so it is replaced. Untyped, as the
// parse always was: callers read fields InstanceConfig does not declare.
function readInstanceConfig(id: string): any {
  const raw = fs.readFileSync(getInstanceConfigPath(id), 'utf8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`The config.json of server ${id} is not valid JSON.`);
  }
}

export async function getAllInstances() {
  return getAllInstancesSync();
}

/** The same list, for callers that cannot wait: the broadcast path reads it from a cache. */
export function getAllInstancesSync() {
  const baseDir = getInstancesBaseDir();
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  const instances = fs.readdirSync(baseDir)
    .filter(id => validateInstanceId(id) && fs.existsSync(path.join(baseDir, id, 'config.json')))
    .map(id => {
      try {
        // The directory name is the id. A config copied in from a backup still carries the id
        // of the server it was taken from.
        return { ...readInstanceConfig(id), id };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // Start All and other bulk operations follow the user's sidebar order.
  return instances.sort((a: any, b: any) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));
}

export function getInstance(id: string) {
  if (!id || typeof id !== 'string') {
    console.warn('[instance-utils] getInstance called with invalid id:', id);
    return null;
  }

  if (!fs.existsSync(getInstanceConfigPath(id))) return null;
  return { ...readInstanceConfig(id), id };
}

/** A server's ports need moving when a server here uses one, or one is outside this machine's ranges. */
function needsOtherPorts(server: PortCarrier, others: PortCarrier[], ranges: ServerPortRanges): boolean {
  return !!findPortConflict(server, others) || portsOutsideRanges(server, ranges).length > 0;
}

function describeRanges({ game, query, rcon }: ServerPortRanges): string {
  const range = (r: { start: number; end: number }) => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`);
  return `game ${range(game)}, query ${range(query)}, RCON ${range(rcon)}`;
}

/**
 * A server moved here from another machine keeps its ports unless a server here already uses
 * one, or one is outside this machine's ranges: then it takes the lowest free ports inside them,
 * as a new server would, so it can start and be reached. Returns the ports it took, or null when
 * it kept its own (or none are free).
 */
export async function takeFreePortsIfNeeded(id: string): Promise<PortSet | null> {
  const all = await getAllInstances();
  const self = all.find(inst => inst.id === id);
  if (!self) return null;
  const others = all.filter(inst => inst.id !== id);
  const { ranges } = getServerPortRanges();
  if (!needsOtherPorts(self, others, ranges)) return null;
  const free = nextFreePortsIn(ranges, others);
  if (!free) {
    console.warn(`[instance-utils] No ports are free in this machine's server ports (${describeRanges(ranges)}) for ${self.name || id}; it keeps its own.`);
    return null;
  }
  const saved = await saveInstance({ ...self, gamePort: free.gamePort, queryPort: free.queryPort, rconPort: free.rconPort });
  return saved.error !== undefined ? null : free;
}

export async function saveInstance(instance: Partial<InstanceConfig>): Promise<SaveOutcome> {
  const id = instance.id || randomUUID();
  const dir = getInstanceDir(id);

  const all = await getAllInstances();
  const name = (instance.name || '').trim().toLowerCase();
  if (all.some(inst => inst.name && inst.name.trim().toLowerCase() === name && inst.id !== id)) {
    return { error: 'A server with this name already exists.' };
  }

  const config: InstanceConfig = { ...instance, id };
  const previous = all.find(inst => inst.id === id);
  const priorRevision = previous && Number.isFinite(Number(previous.configRevision)) ? Number(previous.configRevision) : 0;
  // A mesh apply already carries the desired revision. A local edit bumps from whatever is on disk.
  const incoming = Number(instance.configRevision);
  config.configRevision = Number.isFinite(incoming) && incoming > priorRevision ? incoming : priorRevision + 1;
  for (const field of RUNTIME_FIELDS) {
    delete config[field];
  }

  // A new server takes the lowest free ports inside this machine's ranges when its own are taken
  // or outside them: the ranges are what the firewall opens. Shared ports never stop the save of
  // an existing server: two servers on one port can be kept, and only one of them run at a time,
  // which starting checks.
  const others = all.filter(inst => inst.id !== id);
  if (!all.some(inst => inst.id === id)) {
    const { ranges } = getServerPortRanges();
    if (needsOtherPorts(config, others, ranges)) {
      const free = nextFreePortsIn(ranges, others);
      if (!free) {
        return { error: `No ports are left in this machine's server ports (${describeRanges(ranges)}). Widen them in Settings → Server Defaults → Server Ports.` };
      }
      config.gamePort = free.gamePort;
      config.queryPort = free.queryPort;
      config.rconPort = free.rconPort;
    }
  }

  // A new server has no place in the sidebar yet. Give it the next place, and give any
  // server that was never ordered a place of its own first, so the new one stays last.
  const isNew = !all.some(inst => inst.id === id);
  if (isNew && !Number.isFinite(config.sortOrder)) {
    let max = -1;
    for (const inst of all) {
      if (Number.isFinite(inst.sortOrder)) {
        max = Math.max(max, inst.sortOrder as number);
        continue;
      }
      max += 1;
      writeJsonAtomic(getInstanceConfigPath(inst.id), { ...inst, sortOrder: max });
    }
    config.sortOrder = max + 1;
  }

  fs.mkdirSync(dir, { recursive: true });
  writeJsonAtomic(path.join(dir, 'config.json'), config);
  notifyInstancesChanged();
  return config;
}

export function deleteInstance(id: string) {
  if (!validateInstanceId(id)) {
    console.error('[instance-utils] deleteInstance called with invalid id:', id);
    return false;
  }
  const dir = getInstanceDir(id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    notifyInstancesChanged();
    return true;
  }
  return false;
}

export function getInstanceSaveDir(instanceDir: string): string {
  return path.join(instanceDir, 'SavedArks');
}
