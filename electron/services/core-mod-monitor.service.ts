import axios from 'axios';
import * as path from 'path';
import { getAllInstances, getInstance } from '../utils/ark/instance.utils';
import { getDefaultInstallDir } from '../utils/platform.utils';
import { loadGlobalConfig } from '../utils/global-config.utils';
import { readJsonOrQuarantine, writeJsonAtomic } from '../utils/fs.utils';
import { localNode, meshServer } from './mesh/mesh-hooks';
import { restartCountdowns } from './automation/restart-countdown.service';
import { localRuntime } from './runtime/local-runtime';

/** Each host watches only its own servers. Baselines survive app restarts; first observation is not an update. */
export class CoreModMonitor {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly pending = new Set<string>();
  private versions: Record<string, Record<string, number>> = {};
  private get statePath(): string { return path.join(getDefaultInstallDir(), 'core-mod-versions.json'); }

  start(): void {
    this.stop();
    this.versions = readJsonOrQuarantine<Record<string, Record<string, number>>>(this.statePath) || {};
    void this.check();
    this.timer = setInterval(() => void this.check(), 15 * 60_000);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  async check(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const apiKey = loadGlobalConfig().curseForgeApiKey || process.env.CURSEFORGE_API_KEY;
      if (!apiKey) return;
      const latest = new Map<string, number>();
      for (const instance of await getAllInstances()) {
        if (meshServer(instance.id)?.nodeId && meshServer(instance.id)!.nodeId !== localNode()) continue;
        if (this.pending.has(instance.id)) continue;
        const mods: string[] = Array.isArray(instance.mods) ? instance.mods.map(String) : [];
        const enabled: string[] = Array.isArray(instance.enabledMods) ? instance.enabledMods.map(String) : mods;
        const core: string[] = Array.isArray(instance.coreMods) ? instance.coreMods.filter((id: string) => /^\d+$/.test(id) && mods.includes(id) && enabled.includes(id)) : [];
        const before = this.versions[instance.id] || {};
        const after: Record<string, number> = {};
        let changed = false;
        for (const id of core) {
          try {
            if (!latest.has(id)) {
              const response = await axios.get(`https://api.curseforge.com/v1/mods/${id}`, { headers: { 'x-api-key': apiKey }, timeout: 15_000 });
              const files = response.data?.data?.latestFiles;
              const fileId = Array.isArray(files) ? Math.max(...files.map((file: { id: number }) => file.id).filter(Number.isSafeInteger)) : 0;
              if (!(fileId > 0)) throw new Error('No published file found');
              latest.set(id, fileId);
            }
            after[id] = latest.get(id)!;
            if (before[id] && after[id] > before[id]) changed = true;
          } catch {
            if (before[id]) after[id] = before[id];
            console.warn(`[core-mods] Could not check mod ${id}; will retry in 15 minutes.`);
          }
        }
        if (changed && localRuntime.state(instance.id) === 'running') {
          if (restartCountdowns.pending().some(item => item.instanceId === instance.id)) continue;
          this.pending.add(instance.id);
          const minutes = Math.min(60, Math.max(0, Number(instance.restartWarningMinutes ?? loadGlobalConfig().updateWarningMinutes ?? 15) || 0));
          restartCountdowns.begin([instance.id], minutes, false, async () => {
            try {
              const current = getInstance(instance.id);
              if (!current || !core.some(id => after[id] > (before[id] || after[id]) && current.coreMods?.includes(id)
                && (!Array.isArray(current.enabledMods) || current.enabledMods.includes(id)))
                || (meshServer(instance.id)?.nodeId && meshServer(instance.id)!.nodeId !== localNode())) return;
              const stopped = await localRuntime.stop(instance.id);
              if (!stopped.success) throw new Error(stopped.error || 'Stop failed');
              const started = await localRuntime.start(instance.id);
              if (!started.started) throw new Error(started.portError || 'Start failed');
              this.versions[instance.id] = after;
              writeJsonAtomic(this.statePath, this.versions);
            } finally { this.pending.delete(instance.id); }
          });
        } else {
          this.versions[instance.id] = after;
        }
      }
      // A cancelled countdown must allow a later check to try again.
      for (const id of this.pending) {
        if (!restartCountdowns.pending().some(item => item.instanceId === id) && localRuntime.state(id) === 'running') this.pending.delete(id);
      }
      writeJsonAtomic(this.statePath, this.versions);
    } catch (error) {
      console.error('[core-mods] Update check failed:', error instanceof Error ? error.message : 'Unknown error');
    } finally { this.busy = false; }
  }
}

export const coreModMonitor = new CoreModMonitor();
