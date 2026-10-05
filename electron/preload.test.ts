import { contextBridge, ipcRenderer } from 'electron';

jest.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: jest.fn() },
  ipcRenderer: { invoke: jest.fn(), send: jest.fn(), on: jest.fn(), removeListener: jest.fn() },
}));

interface ExposedApi {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): () => void;
  versions: { node: string; electron: string; chrome: string };
  platform: string;
}

const mockIpc = jest.mocked(ipcRenderer);

describe('preload', () => {
  let api: ExposedApi;

  beforeAll(() => {
    require('./preload');
    const [name, exposed] = jest.mocked(contextBridge.exposeInMainWorld).mock.calls[0];
    expect(name).toBe('electronAPI');
    api = exposed as ExposedApi;
  });

  describe('invoke', () => {
    it.each(['message', 'window-is-maximized'])('forwards %s to the main process', async channel => {
      mockIpc.invoke.mockResolvedValueOnce('answer');

      await expect(api.invoke(channel, { channel: 'get-users' })).resolves.toBe('answer');
      expect(mockIpc.invoke).toHaveBeenCalledWith(channel, { channel: 'get-users' });
    });

    it.each(['get-users', 'ELECTRON_BROWSER_REQUIRE', ''])('rejects %p without reaching the main process', async channel => {
      await expect(api.invoke(channel)).rejects.toThrow('not allowed');
      expect(mockIpc.invoke).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it.each(['app-close-response', 'window-minimize', 'window-maximize-toggle', 'window-close'])('forwards %s', channel => {
      api.send(channel, { action: 'exit' });

      expect(mockIpc.send).toHaveBeenCalledWith(channel, { action: 'exit' });
    });

    it('ignores any other channel', () => {
      api.send('message', { channel: 'delete-server-instance' });
      api.send('shutdown-all-servers');

      expect(mockIpc.send).not.toHaveBeenCalled();
    });
  });

  describe('on', () => {
    it('hands the listener an empty event instead of the one that exposes ipcRenderer', () => {
      const listener = jest.fn();
      api.on('server-instances', listener);

      const [channel, forward] = mockIpc.on.mock.calls[0];
      expect(channel).toBe('server-instances');
      forward({ sender: ipcRenderer } as unknown as Electron.IpcRendererEvent, [{ id: 'a' }], 'extra');

      expect(listener).toHaveBeenCalledWith({}, [{ id: 'a' }], 'extra');
    });

    it('returns a function that removes exactly that subscription', () => {
      const unsubscribe = api.on('app-close-request', jest.fn());
      const [, forward] = mockIpc.on.mock.calls[0];

      unsubscribe();

      expect(mockIpc.removeListener).toHaveBeenCalledWith('app-close-request', forward);
    });

    it("refuses Electron's own channels", () => {
      expect(() => api.on('ELECTRON_BROWSER_REQUIRE', jest.fn())).toThrow('not allowed');
      expect(mockIpc.on).not.toHaveBeenCalled();
    });
  });

  it('exposes the runtime versions and platform', () => {
    expect(api.versions).toEqual({
      node: process.versions.node,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    });
    expect(api.platform).toBe(process.platform);
  });
});
