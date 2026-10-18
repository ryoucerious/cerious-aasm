import { rconService } from './rcon.service';
import { getInstance } from '../utils/ark/instance.utils';
import { localNode, meshServer } from './mesh/mesh-hooks';

export interface RconSchedule {
  id: string;
  enabled: boolean;
  command: string;
  mode: 'interval' | 'daily';
  intervalMinutes?: number;
  times?: string[];
}

export function validateRconSchedules(value: unknown): asserts value is RconSchedule[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 50) throw new Error('At most 50 RCON schedules are allowed');
  const ids = new Set<string>();
  for (const job of value) {
    if (!job || typeof job.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(job.id) || ids.has(job.id)
      || typeof job.enabled !== 'boolean' || typeof job.command !== 'string' || !job.command.trim()
      || job.command.length > 2000 || /[\r\n\0]/.test(job.command)) throw new Error('Invalid RCON schedule');
    ids.add(job.id);
    if (job.mode === 'interval') {
      if (!Number.isInteger(job.intervalMinutes) || job.intervalMinutes < 1 || job.intervalMinutes > 10080) throw new Error('RCON interval must be 1–10080 minutes');
    } else if (job.mode === 'daily') {
      if (!Array.isArray(job.times) || !job.times.length || job.times.length > 48 || job.times.some((t: unknown) => typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new Error('Use valid HH:MM times for RCON schedules');
    } else throw new Error('Invalid RCON schedule mode');
  }
}

export function nextRconRun(job: RconSchedule, now: number): number {
  if (job.mode === 'interval') return now + job.intervalMinutes! * 60_000;
  return Math.min(...job.times!.map(time => {
    const [hours, minutes] = time.split(':').map(Number);
    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);
    if (date.getTime() <= now) date.setDate(date.getDate() + 1);
    return date.getTime();
  }));
}

/** Timers live only on the hosting process. Re-read config before every command. */
export class RconScheduleService {
  private jobs = new Map<string, Map<string, { signature: string; next: number }>>();
  private busy = new Set<string>();
  forget(id: string): void { this.jobs.delete(id); }

  async tick(id: string): Promise<void> {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    try {
      const placement = meshServer(id);
      if (placement && placement.nodeId !== localNode()) { this.forget(id); return; }
      const schedules = getInstance(id)?.rconSchedules as RconSchedule[] | undefined;
      validateRconSchedules(schedules);
      const now = Date.now();
      const previous = this.jobs.get(id) || new Map();
      const current = new Map<string, { signature: string; next: number }>();
      for (const job of schedules || []) {
        if (!job.enabled) continue;
        const signature = JSON.stringify(job);
        const old = previous.get(job.id);
        const state = old?.signature === signature ? old : { signature, next: nextRconRun(job, now) };
        current.set(job.id, state);
        if (state.next > now) continue;
        // Advance before I/O: disconnected servers skip the occurrence, and slow commands cannot overlap.
        state.next = nextRconRun(job, now);
        const stillScheduled = () => {
          const host = meshServer(id);
          if (host && host.nodeId !== localNode()) return false;
          const latest = getInstance(id)?.rconSchedules as RconSchedule[] | undefined;
          return !!latest?.some(item => item.enabled && item.id === job.id && JSON.stringify(item) === signature);
        };
        if (!stillScheduled()) { current.delete(job.id); continue; }
        const result = await rconService.executeRconCommand(id, job.command, undefined, stillScheduled);
        if (!result.success) console.warn(`[rcon-schedule] ${id}/${job.id}: ${result.error || 'Command failed'}`);
      }
      this.jobs.set(id, current);
    } catch (error) {
      console.error(`[rcon-schedule] Could not run schedules for ${id}:`, error);
    } finally {
      this.busy.delete(id);
    }
  }
}

export const rconSchedules = new RconScheduleService();
