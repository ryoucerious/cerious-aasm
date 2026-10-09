import { messagingService } from '../services/messaging.service';
import { installService } from '../services/install.service';
import type { ServerInstallProgress } from '../services/server-installer.service';
import { serverProcessService } from '../services/server-instance/server-process.service';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/server-instance/server-process.service', () => ({
  serverProcessService: { getActiveInstanceIds: jest.fn(() => []) }
}));
jest.mock('../services/install.service', () => ({
  installService: { checkInstallRequirements: jest.fn(), installComponent: jest.fn(), cancelInstallation: jest.fn() }
}));

const mockMessaging = jest.mocked(messagingService);
const mockInstall = jest.mocked(installService);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('install-handler', () => {
  const sender = { send: jest.fn() };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./install-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  function replies(channel: string): unknown[] {
    return mockMessaging.sendToOriginator.mock.calls.filter(([replyChannel]) => replyChannel === channel).map(call => call[1]);
  }

  describe('check-install-requirements', () => {
    it('replies with the requirements', async () => {
      const requirements = { success: true, requiresSudo: true, missingDependencies: [], canProceed: true, message: 'All requirements met' };
      mockInstall.checkInstallRequirements.mockResolvedValue(requirements);

      await handlers['check-install-requirements']({ target: 'server', requestId: 'r1' }, sender);

      expect(mockInstall.checkInstallRequirements).toHaveBeenCalledWith('server');
      expect(replies('check-install-requirements')).toEqual([{ ...requirements, requestId: 'r1' }]);
    });

    it.each([
      ['an Error', new Error('System check failed'), 'System check failed'],
      ['a string', 'String error', 'String error']
    ])('replies a failure when the check throws %s', async (_label, thrown, error) => {
      mockInstall.checkInstallRequirements.mockRejectedValue(thrown);

      await handlers['check-install-requirements']({ target: 'server', requestId: 'r1' }, sender);

      expect(replies('check-install-requirements')).toEqual([{ success: false, error, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      const requirements = { success: false, requiresSudo: false, missingDependencies: [], canProceed: false, message: 'Invalid target' };
      mockInstall.checkInstallRequirements.mockResolvedValue(requirements);

      await handlers['check-install-requirements'](undefined, sender);

      expect(mockInstall.checkInstallRequirements).toHaveBeenCalledWith(undefined);
      expect(replies('check-install-requirements')).toEqual([{ ...requirements, requestId: undefined }]);
    });
  });

  describe('install', () => {
    // Only the page checked this; SteamCMD replaced files a running server had open.
    it('will not update the ARK files while a server on this machine is up', async () => {
      jest.mocked(serverProcessService.getActiveInstanceIds).mockReturnValueOnce(['isle']);

      await handlers['install']({ target: 'server', requestId: 'r9' }, sender);

      expect(mockInstall.installComponent).not.toHaveBeenCalled();
      expect(replies('install')).toEqual([expect.objectContaining({ data: expect.objectContaining({ error: 'Stop this machine\'s servers before installing or updating ARK.' }) })]);
    });

    it('forwards each progress report with the requestId, then the result', async () => {
      const step: ServerInstallProgress = { phasePercent: 40, step: 'ark-download', message: 'Downloading', phase: 'ark-download', overallPhase: 'Installing' };
      mockInstall.installComponent.mockImplementation(async (_target, progress) => {
        progress(step);
        return { status: 'success', target: 'server', message: 'Installed' };
      });

      await handlers['install']({ target: 'server', sudoPassword: 'pw', requestId: 'r1' }, sender);

      expect(mockInstall.installComponent).toHaveBeenCalledWith('server', expect.any(Function), 'pw');
      expect(replies('install')).toEqual([
        { target: 'server', data: { ...step, requestId: 'r1' }, requestId: 'r1' },
        { target: 'server', data: { status: 'success', target: 'server', message: 'Installed', requestId: 'r1' }, requestId: 'r1' }
      ]);
    });

    it('forwards a text progress line as it is', async () => {
      mockInstall.installComponent.mockImplementation(async (_target, progress) => {
        progress('SteamCMD already installed.');
        return { status: 'success', target: 'steamcmd' };
      });

      await handlers['install']({ target: 'steamcmd', requestId: 'r1' }, sender);

      expect(replies('install')[0]).toEqual({ target: 'steamcmd', data: 'SteamCMD already installed.', requestId: 'r1' });
    });

    it('logs a text progress line that reports an error', async () => {
      mockInstall.installComponent.mockImplementation(async (_target, progress) => {
        progress('Error: Something went wrong');
        progress('Just a message');
        return { status: 'success', target: 'steamcmd' };
      });

      await handlers['install']({ target: 'steamcmd', requestId: 'r1' }, sender);

      expect(console.error).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith('[install-handler] [steamcmd] Error: Something went wrong');
    });

    it.each([
      ['its error', 'server', { status: 'error' as const, target: 'server', error: 'An install is already in progress.' }, 'server', 'An install is already in progress.'],
      ['a fallback', 'server', { status: 'error' as const, target: 'server' }, 'server', 'Installation failed'],
      ['an unknown target', undefined, { status: 'error' as const, target: undefined, error: 'Something went wrong' }, 'unknown', 'Something went wrong']
    ])('reports a failed install with %s in both error and message', async (_label, requested, result, target, error) => {
      mockInstall.installComponent.mockResolvedValue(result as Awaited<ReturnType<typeof installService.installComponent>>);

      await handlers['install']({ target: requested, requestId: 'r1' }, sender);

      expect(replies('install')).toEqual([{
        target,
        data: { error, message: error, step: 'error', target: result.target, requestId: 'r1' },
        requestId: 'r1'
      }]);
    });

    it.each([
      ['an Error', new Error('Network timeout'), 'Network timeout'],
      ['a string', 'String error', 'String error']
    ])('reports a failed install when installing throws %s', async (_label, thrown, error) => {
      mockInstall.installComponent.mockRejectedValue(thrown);

      await handlers['install']({ target: 'proton', requestId: 'r1' }, sender);

      expect(replies('install')).toEqual([{
        target: 'proton',
        data: { error, message: error, step: 'error', phase: 'error', overallPhase: 'Installation Failed', phasePercent: 0, requestId: 'r1' },
        requestId: 'r1'
      }]);
    });

    it('answers a request without a payload', async () => {
      mockInstall.installComponent.mockResolvedValue({ status: 'error', target: 'unknown', error: 'Invalid install target' });

      await handlers['install'](undefined, sender);

      expect(mockInstall.installComponent).toHaveBeenCalledWith(undefined, expect.any(Function), undefined);
      expect(replies('install')).toEqual([expect.objectContaining({ target: 'unknown', requestId: undefined })]);
    });
  });

  describe('cancel-install', () => {
    it('cancels and reports it in data', async () => {
      mockInstall.cancelInstallation.mockReturnValue({ success: true, target: 'server' });

      await handlers['cancel-install']({ target: 'server', requestId: 'r1' }, sender);

      expect(mockInstall.cancelInstallation).toHaveBeenCalledWith('server');
      expect(replies('cancel-install')).toEqual([{ target: 'server', data: { cancelled: true, requestId: 'r1' }, requestId: 'r1' }]);
    });

    it('says in data when the target cannot be cancelled', async () => {
      mockInstall.cancelInstallation.mockReturnValue({ success: false, target: 'steamcmd' });

      await handlers['cancel-install']({ target: 'steamcmd', requestId: 'r1' }, sender);

      expect(replies('cancel-install')).toEqual([{
        target: 'steamcmd', data: { error: 'Cancellation not supported for this target', requestId: 'r1' }, requestId: 'r1'
      }]);
    });

    it.each([
      ['an Error', { target: 'proton', requestId: 'r1' }, new Error('Process not found'), 'proton', 'Process not found'],
      ['a string without a target', { requestId: 'r1' }, 'String error', 'unknown', 'String error']
    ])('reports the failure in data when cancelling throws %s', async (_label, payload, thrown, target, error) => {
      mockInstall.cancelInstallation.mockImplementation(() => { throw thrown; });

      await handlers['cancel-install'](payload, sender);

      expect(replies('cancel-install')).toEqual([{ target, data: { error, requestId: 'r1' }, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockInstall.cancelInstallation.mockReturnValue({ success: false, target: 'unknown' });

      await handlers['cancel-install'](undefined, sender);

      expect(mockInstall.cancelInstallation).toHaveBeenCalledWith(undefined);
      expect(replies('cancel-install')).toEqual([{
        target: 'unknown', data: { error: 'Cancellation not supported for this target', requestId: undefined }, requestId: undefined
      }]);
    });
  });
});
