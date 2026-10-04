import { Injectable, NgZone } from '@angular/core';
import type { ElectronApi, ElectronInvokeChannel, ElectronListener, ElectronSendChannel } from '../types/electron-api';

/** The desktop app's bridge to the main process. Every call is a no-op or a rejection in the web UI. */
@Injectable({ providedIn: 'root' })
export class IpcService {
  private readonly api: ElectronApi | undefined = window.electronAPI;
  private readonly unsubscribers = new Map<string, Map<ElectronListener, () => void>>();

  constructor(private zone: NgZone) {}

  /** True in the desktop app, where the preload script provides the bridge. */
  get isElectron(): boolean {
    return !!this.api;
  }

  /** Node, Electron and Chrome versions of the desktop app; null in the web UI. */
  get versions(): ElectronApi['versions'] | null {
    return this.api?.versions ?? null;
  }

  invoke(channel: ElectronInvokeChannel, ...args: unknown[]): Promise<unknown> {
    if (!this.api) return Promise.reject(new Error('Not running in Electron'));
    return this.api.invoke(channel, ...args);
  }

  send(channel: ElectronSendChannel, ...args: unknown[]): void {
    this.api?.send(channel, ...args);
  }

  /** Listens on `channel` until the returned function is called. The listener runs inside Angular's zone. */
  on(channel: string, listener: ElectronListener): () => void {
    if (!this.api) return () => {};
    this.removeListener(channel, listener);

    // The bridge calls back from outside Angular's zone, so change detection would not run.
    const unsubscribe = this.api.on(channel, (event, ...args) => this.zone.run(() => listener(event, ...args)));
    const forChannel = this.unsubscribers.get(channel) ?? new Map<ElectronListener, () => void>();
    this.unsubscribers.set(channel, forChannel);
    forChannel.set(listener, unsubscribe);

    // Only this registration: the same listener may have been registered again since.
    return () => {
      if (this.unsubscribers.get(channel)?.get(listener) === unsubscribe) {
        this.removeListener(channel, listener);
      }
    };
  }

  removeListener(channel: string, listener: ElectronListener): void {
    const forChannel = this.unsubscribers.get(channel);
    const unsubscribe = forChannel?.get(listener);
    if (!forChannel || !unsubscribe) return;
    unsubscribe();
    forChannel.delete(listener);
    if (forChannel.size === 0) this.unsubscribers.delete(channel);
  }
}
