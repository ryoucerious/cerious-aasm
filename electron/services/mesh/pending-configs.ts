import { readJsonOrQuarantine, writeJsonAtomic } from '../../utils/fs.utils';

/**
 * Servers hosted here whose saved config the mesh could not store (no quorum). The config itself
 * is on disk in the server's own directory; this only lists which ones to record again.
 */
export class PendingConfigs {
  private readonly pending: Set<string>;

  constructor(private readonly file: string) {
    let stored: unknown;
    try {
      stored = readJsonOrQuarantine<unknown>(file);
    } catch {
      stored = undefined;
    }
    this.pending = new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
  }

  add(serverId: string): void {
    if (this.pending.has(serverId)) return;
    this.pending.add(serverId);
    this.save();
  }

  remove(serverId: string): void {
    if (!this.pending.delete(serverId)) return;
    this.save();
  }

  ids(): string[] {
    return [...this.pending];
  }

  private save(): void {
    writeJsonAtomic(this.file, [...this.pending]);
  }
}
