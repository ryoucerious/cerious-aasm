import { BrowserWindow, dialog } from 'electron';
import { messagingService } from '../services/messaging.service';
import { directoryService } from '../services/directory.service';

jest.mock('electron', () => ({
  dialog: { showOpenDialog: jest.fn() },
  BrowserWindow: { fromWebContents: jest.fn() }
}));
jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/directory.service', () => ({
  directoryService: { openConfigDirectory: jest.fn(), openInstanceDirectory: jest.fn(), testDirectoryAccess: jest.fn() }
}));

const mockMessaging = jest.mocked(messagingService);
const mockDirectory = jest.mocked(directoryService);
const mockFromWebContents = jest.mocked(BrowserWindow.fromWebContents);
const mockShowOpenDialog = jest.mocked(dialog.showOpenDialog);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('directory-handler', () => {
  const desktop = { send: jest.fn() };
  const win = {} as BrowserWindow;
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./directory-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  function repliesOn(channel: string): unknown[] {
    return mockMessaging.sendToOriginator.mock.calls.filter(([replyChannel]) => replyChannel === channel).map(call => call[1]);
  }

  function channelsReplied(): unknown[] {
    return mockMessaging.sendToOriginator.mock.calls.map(([channel]) => channel);
  }

  describe('select-directory', () => {
    beforeEach(() => {
      mockFromWebContents.mockReturnValue(win);
    });

    it('opens a folder picker over the window and replies with the chosen path', async () => {
      mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\ARK Servers'] });

      await handlers['select-directory']({ title: 'Select Server Data Directory', requestId: 'r1' }, desktop);

      expect(mockFromWebContents).toHaveBeenCalledWith(desktop);
      expect(mockShowOpenDialog).toHaveBeenCalledWith(win, {
        title: 'Select Server Data Directory', properties: ['openDirectory', 'createDirectory']
      });
      expect(repliesOn('select-directory')).toEqual([{ path: 'D:\\ARK Servers', requestId: 'r1' }]);
    });

    it.each([
      [{ canceled: true, filePaths: [] }],
      [{ canceled: false, filePaths: [] }]
    ])('replies canceled when nothing was picked (%p)', async result => {
      mockShowOpenDialog.mockResolvedValue(result);

      await handlers['select-directory']({ requestId: 'r1' }, desktop);

      expect(repliesOn('select-directory')).toEqual([{ canceled: true, requestId: 'r1' }]);
    });

    it('replies the failure on its own channel when the sender has no window', async () => {
      mockFromWebContents.mockReturnValue(null);

      await handlers['select-directory']({ requestId: 'r1' }, desktop);

      expect(mockShowOpenDialog).not.toHaveBeenCalled();
      expect(channelsReplied()).toEqual(['select-directory']);
      expect(repliesOn('select-directory')).toEqual([{ success: false, error: 'Could not determine window', requestId: 'r1' }]);
    });

    it('refuses a web client, which has no window to open the dialog over', async () => {
      const webClient = { type: 'api-process', cid: 'c1', user: null, authEnabled: false, send: jest.fn() };

      await handlers['select-directory']({ requestId: 'r1' }, webClient);

      expect(mockFromWebContents).not.toHaveBeenCalled();
      expect(repliesOn('select-directory')).toEqual([{ success: false, error: 'Could not determine window', requestId: 'r1' }]);
    });

    it('replies { error } without success when the dialog fails', async () => {
      mockShowOpenDialog.mockRejectedValue(new Error('Dialog failed'));

      await handlers['select-directory']({ requestId: 'r1' }, desktop);

      expect(repliesOn('select-directory')).toEqual([{ error: 'Dialog failed', requestId: 'r1' }]);
    });

    it('answers a request without a payload with the default title', async () => {
      mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

      await handlers['select-directory'](undefined, desktop);

      expect(mockShowOpenDialog).toHaveBeenCalledWith(win, expect.objectContaining({ title: 'Select Directory' }));
      expect(repliesOn('select-directory')).toEqual([{ canceled: true, requestId: undefined }]);
    });
  });

  describe('open-config-directory', () => {
    it('opens the config directory and replies with its path', async () => {
      mockDirectory.openConfigDirectory.mockResolvedValue({ success: true, configDir: '/config' });

      await handlers['open-config-directory']({ requestId: 'r1' }, desktop);

      expect(repliesOn('open-config-directory')).toEqual([{ configDir: '/config', requestId: 'r1' }]);
    });

    it('replies the failure on its own channel', async () => {
      mockDirectory.openConfigDirectory.mockResolvedValue({ success: false, configDir: '', error: 'Directory not found' });

      await handlers['open-config-directory']({ requestId: 'r1' }, desktop);

      expect(channelsReplied()).toEqual(['open-config-directory']);
      expect(repliesOn('open-config-directory')).toEqual([{ success: false, error: 'Directory not found', requestId: 'r1' }]);
    });

    it.each([
      ['an Error', new Error('Permission denied'), 'Permission denied'],
      ['a string', 'String error', 'String error']
    ])('replies the failure on its own channel when opening throws %s', async (_label, thrown, error) => {
      mockDirectory.openConfigDirectory.mockRejectedValue(thrown);

      await handlers['open-config-directory']({ requestId: 'r1' }, desktop);

      expect(channelsReplied()).toEqual(['open-config-directory']);
      expect(repliesOn('open-config-directory')).toEqual([{ success: false, error, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockDirectory.openConfigDirectory.mockResolvedValue({ success: true, configDir: '/config' });

      await handlers['open-config-directory'](undefined, desktop);

      expect(repliesOn('open-config-directory')).toEqual([{ configDir: '/config', requestId: undefined }]);
    });
  });

  describe('open-directory', () => {
    it('opens the server directory and replies with its id', async () => {
      mockDirectory.openInstanceDirectory.mockResolvedValue({ success: true, instanceId: 'a1' });

      await handlers['open-directory']({ id: 'a1', requestId: 'r1' }, desktop);

      expect(mockDirectory.openInstanceDirectory).toHaveBeenCalledWith('a1');
      expect(repliesOn('open-directory')).toEqual([{ id: 'a1', requestId: 'r1' }]);
    });

    it('replies the failure on its own channel', async () => {
      mockDirectory.openInstanceDirectory.mockResolvedValue({ success: false, error: 'Invalid instance ID' });

      await handlers['open-directory']({ id: '../x', requestId: 'r1' }, desktop);

      expect(channelsReplied()).toEqual(['open-directory']);
      expect(repliesOn('open-directory')).toEqual([{ success: false, error: 'Invalid instance ID', requestId: 'r1' }]);
    });

    it('replies the failure on its own channel when opening throws', async () => {
      mockDirectory.openInstanceDirectory.mockRejectedValue(new Error('Directory access failed'));

      await handlers['open-directory']({ id: 'a1', requestId: 'r1' }, desktop);

      expect(channelsReplied()).toEqual(['open-directory']);
      expect(repliesOn('open-directory')).toEqual([{ success: false, error: 'Directory access failed', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockDirectory.openInstanceDirectory.mockResolvedValue({ success: false, error: 'Invalid instance ID' });

      await handlers['open-directory'](undefined, desktop);

      expect(mockDirectory.openInstanceDirectory).toHaveBeenCalledWith(undefined);
      expect(repliesOn('open-directory')).toEqual([{ success: false, error: 'Invalid instance ID', requestId: undefined }]);
    });
  });

  describe('test-directory-access', () => {
    it.each([
      [{ accessible: true }, { accessible: true, error: undefined }],
      [{ accessible: false, error: 'Permission denied' }, { accessible: false, error: 'Permission denied' }]
    ])('replies whether the directory can be used (%p)', async (result, reply) => {
      mockDirectory.testDirectoryAccess.mockResolvedValue(result);

      await handlers['test-directory-access']({ directoryPath: '/cluster', requestId: 'r1' }, desktop);

      expect(mockDirectory.testDirectoryAccess).toHaveBeenCalledWith('/cluster');
      expect(repliesOn('test-directory-access')).toEqual([{ ...reply, requestId: 'r1' }]);
    });

    it.each([
      ['an Error', new Error('File system error'), 'File system error'],
      ['a string', 'String error', 'String error']
    ])('replies not accessible when the check throws %s', async (_label, thrown, error) => {
      mockDirectory.testDirectoryAccess.mockRejectedValue(thrown);

      await handlers['test-directory-access']({ directoryPath: '/cluster', requestId: 'r1' }, desktop);

      expect(repliesOn('test-directory-access')).toEqual([{ accessible: false, error, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockDirectory.testDirectoryAccess.mockResolvedValue({ accessible: false, error: 'No directory given' });

      await handlers['test-directory-access'](undefined, desktop);

      expect(mockDirectory.testDirectoryAccess).toHaveBeenCalledWith(undefined);
      expect(repliesOn('test-directory-access')).toEqual([{ accessible: false, error: 'No directory given', requestId: undefined }]);
    });

    it.each([
      ['a web client', { type: 'api-process', cid: 'c1', user: null, authEnabled: false, send: jest.fn() }],
      ['a raw socket', { readyState: 1, send: jest.fn() }],
      ['no sender', undefined]
    ])('refuses %s without looking at the path', async (_label, sender) => {
      await handlers['test-directory-access']({ directoryPath: 'C:\\Windows', requestId: 'r1' }, sender);

      expect(mockDirectory.testDirectoryAccess).not.toHaveBeenCalled();
      expect(repliesOn('test-directory-access')).toEqual([
        { success: false, accessible: false, error: 'Directory checks are only available in the desktop app', requestId: 'r1' }
      ]);
    });
  });
});
