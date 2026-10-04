import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// All the sandboxed, context-isolated page can reach of the main process; the frontend declares
// the same shape in src/app/core/types/electron-api.d.ts. A sandboxed preload can require only
// 'electron', so this file imports nothing else.

const INVOKE_CHANNELS = ['message', 'window-is-maximized'] as const;
const SEND_CHANNELS = ['app-close-response', 'window-minimize', 'window-maximize-toggle', 'window-close'] as const;

type InvokeChannel = typeof INVOKE_CHANNELS[number];
type SendChannel = typeof SEND_CHANNELS[number];
type Listener = (event: unknown, ...args: unknown[]) => void;

// The page is untrusted: whatever the types say, a channel may be any value at runtime.
function isOneOf<T extends string>(allowed: readonly T[], channel: unknown): channel is T {
  return (allowed as readonly unknown[]).includes(channel);
}

contextBridge.exposeInMainWorld('electronAPI', {
  invoke(channel: InvokeChannel, ...args: unknown[]): Promise<unknown> {
    if (!isOneOf(INVOKE_CHANNELS, channel)) {
      return Promise.reject(new Error(`Channel not allowed: ${String(channel)}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  send(channel: SendChannel, ...args: unknown[]): void {
    if (isOneOf(SEND_CHANNELS, channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },

  on(channel: string, listener: Listener): () => void {
    // Electron reserves the ELECTRON_ prefix for its internal messages.
    if (typeof channel !== 'string' || channel.startsWith('ELECTRON_')) {
      throw new Error(`Channel not allowed: ${String(channel)}`);
    }
    // The real event carries ipcRenderer as `sender`, which would hand the page all of IPC.
    const forward = (_event: IpcRendererEvent, ...args: unknown[]) => listener({}, ...args);
    ipcRenderer.on(channel, forward);
    return () => {
      ipcRenderer.removeListener(channel, forward);
    };
  },

  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  platform: process.platform,
});
