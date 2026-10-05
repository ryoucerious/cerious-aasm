export type ElectronInvokeChannel = 'message' | 'window-is-maximized';
export type ElectronSendChannel = 'app-close-response' | 'window-minimize' | 'window-maximize-toggle' | 'window-close';
export type ElectronListener = (event: unknown, ...args: unknown[]) => void;

/** A file chosen in the page. Electron (before version 32) adds its path on disk; a browser does not. */
export type DesktopFile = File & { path?: string };

/**
 * What electron/preload.ts exposes as window.electronAPI (contextIsolation on, no Node in the page).
 * invoke and send refuse channels outside their allow-lists.
 */
export interface ElectronApi {
  invoke(channel: ElectronInvokeChannel, ...args: unknown[]): Promise<unknown>;
  send(channel: ElectronSendChannel, ...args: unknown[]): void;
  /** Returns the unsubscribe function. `event` is an empty object. */
  on(channel: string, listener: ElectronListener): () => void;
  versions: { node: string; electron: string; chrome: string };
  platform: string;
}

declare global {
  interface Window {
    /** Present only in the desktop app. */
    electronAPI?: ElectronApi;
  }
}
