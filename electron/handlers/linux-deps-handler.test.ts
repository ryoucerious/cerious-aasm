import { messagingService } from '../services/messaging.service';
import { LinuxDepsService } from '../services/linux-deps.service';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/linux-deps.service');

const mockMessaging = jest.mocked(messagingService);
const mockService = jest.mocked(LinuxDepsService.prototype);

type Listener = (payload: unknown, sender: unknown) => Promise<void> | void;

const steamcmd = {
  name: 'steamcmd',
  packageName: 'steamcmd',
  checkCommand: 'which steamcmd',
  description: 'SteamCMD for ARK server management',
  required: true
};
const allInstalled = {
  success: true, platform: 'linux', dependencies: [], missing: [], missingRequired: [],
  allDepsInstalled: true, canProceed: true, message: 'All Linux dependencies are installed'
};

describe('linux-deps-handler', () => {
  const sender = { send: jest.fn() };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./linux-deps-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  function sentOn(channel: string): unknown[] {
    return mockMessaging.sendToOriginator.mock.calls
      .filter(([replyChannel, , to]) => replyChannel === channel && to === (sender as unknown))
      .map(call => call[1]);
  }

  describe('check-linux-deps', () => {
    it('replies on linux-deps-check-result', async () => {
      mockService.checkDependencies.mockResolvedValue(allInstalled);

      await handlers['check-linux-deps']({ requestId: 'r1' }, sender);

      expect(sentOn('linux-deps-check-result')).toEqual([{ ...allInstalled, requestId: 'r1' }]);
    });

    it.each([
      ['an Error', new Error('System error'), 'System error'],
      ['nothing useful', undefined, 'Unexpected error']
    ])('replies a failure when the check throws %s', async (_label, thrown, error) => {
      mockService.checkDependencies.mockRejectedValue(thrown);

      await handlers['check-linux-deps']({ requestId: 'r1' }, sender);

      expect(sentOn('linux-deps-check-result')).toEqual([{ success: false, error, requestId: 'r1' }]);
    });

    it.each([undefined, null])('answers a request without a payload (%p)', async payload => {
      mockService.checkDependencies.mockResolvedValue(allInstalled);

      await handlers['check-linux-deps'](payload, sender);

      expect(sentOn('linux-deps-check-result')).toEqual([{ ...allInstalled, requestId: undefined }]);
    });
  });

  describe('validate-sudo-password', () => {
    it('replies on sudo-password-validation', async () => {
      mockService.validateSudoPassword.mockResolvedValue({ valid: true, error: null });

      await handlers['validate-sudo-password']({ password: 'hunter2', requestId: 'r1' }, sender);

      expect(mockService.validateSudoPassword).toHaveBeenCalledWith('hunter2');
      expect(sentOn('sudo-password-validation')).toEqual([{ valid: true, error: null, requestId: 'r1' }]);
    });

    it('replies invalid, and logs no password, when validation throws', async () => {
      mockService.validateSudoPassword.mockRejectedValue(new Error('sudo failed'));

      await handlers['validate-sudo-password']({ password: 'hunter2', requestId: 'r1' }, sender);

      expect(sentOn('sudo-password-validation')).toEqual([{ valid: false, error: 'sudo failed', requestId: 'r1' }]);
      expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain('hunter2');
    });

    it('answers a request without a payload', async () => {
      mockService.validateSudoPassword.mockResolvedValue({ valid: false, error: 'Password is required' });

      await handlers['validate-sudo-password'](undefined, sender);

      expect(mockService.validateSudoPassword).toHaveBeenCalledWith(undefined);
      expect(sentOn('sudo-password-validation')).toEqual([{ valid: false, error: 'Password is required', requestId: undefined }]);
    });
  });

  describe('install-linux-deps', () => {
    it('passes the dependency names on, then forwards progress and the result on their channels', async () => {
      mockService.installDependencies.mockImplementation(async (_password, _dependencies, progress) => {
        progress?.({ step: 'install', message: 'Halfway', percent: 50, dependency: 'Xvfb' });
        return { success: true, message: 'done', details: [] };
      });

      await handlers['install-linux-deps']({ password: 'hunter2', dependencies: ['Xvfb'], requestId: 'r1' }, sender);

      expect(mockService.installDependencies).toHaveBeenCalledWith('hunter2', ['Xvfb'], expect.any(Function));
      expect(sentOn('linux-deps-install-progress')).toEqual([
        { step: 'install', message: 'Halfway', percent: 50, dependency: 'Xvfb', requestId: 'r1' }
      ]);
      expect(sentOn('linux-deps-install-result')).toEqual([{ success: true, message: 'done', details: [], requestId: 'r1' }]);
    });

    it.each([
      ['an Error', new Error('apt locked'), 'apt locked'],
      ['nothing useful', undefined, 'Unexpected error during installation']
    ])('replies a failure with no details when installing throws %s', async (_label, thrown, error) => {
      mockService.installDependencies.mockRejectedValue(thrown);

      await handlers['install-linux-deps']({ password: 'hunter2', dependencies: [], requestId: 'r1' }, sender);

      expect(sentOn('linux-deps-install-result')).toEqual([{ success: false, error, details: [], requestId: 'r1' }]);
      expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain('hunter2');
    });

    it.each([undefined, null])('answers a request without a payload (%p)', async payload => {
      mockService.installDependencies.mockResolvedValue({ success: false, error: 'Invalid sudo password', details: [] });

      await handlers['install-linux-deps'](payload, sender);

      expect(mockService.installDependencies).toHaveBeenCalledWith(undefined, undefined, expect.any(Function));
      expect(sentOn('linux-deps-install-result')).toEqual([
        { success: false, error: 'Invalid sudo password', details: [], requestId: undefined }
      ]);
    });
  });

  describe('get-linux-deps-list', () => {
    it('replies on linux-deps-list', async () => {
      mockService.getAvailableDependencies.mockReturnValue({ dependencies: [steamcmd], platform: 'linux' });

      await handlers['get-linux-deps-list']({ requestId: 'r1' }, sender);

      expect(sentOn('linux-deps-list')).toEqual([{ dependencies: [steamcmd], platform: 'linux', requestId: 'r1' }]);
    });

    it.each([
      ['an Error', new Error('List retrieval failed'), 'List retrieval failed'],
      ['nothing useful', undefined, 'Unexpected error']
    ])('replies an empty list when listing throws %s', async (_label, thrown, error) => {
      mockService.getAvailableDependencies.mockImplementation(() => { throw thrown; });

      await handlers['get-linux-deps-list']({ requestId: 'r1' }, sender);

      expect(sentOn('linux-deps-list')).toEqual([{ dependencies: [], platform: 'unknown', error, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockService.getAvailableDependencies.mockReturnValue({ dependencies: [], platform: 'linux' });

      await handlers['get-linux-deps-list'](undefined, sender);

      expect(sentOn('linux-deps-list')).toEqual([{ dependencies: [], platform: 'linux', requestId: undefined }]);
    });
  });
});
