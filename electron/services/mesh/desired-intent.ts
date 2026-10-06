import type { DesiredState } from '../../types/mesh.types';
import { readJsonOrQuarantine, writeJsonAtomic } from '../../utils/fs.utils';

/**
 * Start and stop decisions made on this node for the servers it hosts. Each one is written to
 * the mesh; until that write succeeds (no quorum) it is kept here, on disk, and wins over the
 * replicated row. A partition or a reboot during one therefore never undoes a local stop.
 */
export class DesiredIntents {
  private readonly pending: Map<string, DesiredState>;

  constructor(private readonly file: string) {
    let stored: Record<string, DesiredState> | undefined;
    try {
      stored = readJsonOrQuarantine<Record<string, DesiredState>>(file);
    } catch {
      stored = undefined;
    }
    this.pending = new Map(Object.entries(stored && typeof stored === 'object' ? stored : {})
      .filter((entry): entry is [string, DesiredState] => entry[1] === 'running' || entry[1] === 'stopped'));
  }

  get(serverId: string): DesiredState | undefined {
    return this.pending.get(serverId);
  }

  set(serverId: string, desired: DesiredState): void {
    this.pending.set(serverId, desired);
    this.save();
  }

  /** The mesh now holds `desired`. A decision made after it stays pending. */
  settle(serverId: string, desired: DesiredState): void {
    if (this.pending.get(serverId) !== desired) return;
    this.pending.delete(serverId);
    this.save();
  }

  entries(): Array<[string, DesiredState]> {
    return [...this.pending.entries()];
  }

  private save(): void {
    writeJsonAtomic(this.file, Object.fromEntries(this.pending));
  }
}
