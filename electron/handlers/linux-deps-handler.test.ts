import { messagingService } from '../services/messaging.service';
import { LinuxDepsService } from '../services/linux-deps.service';

// Mock the services
jest.mock('../services/messaging.service');
jest.mock('../services/linux-deps.service');

const mockMessagingService = messagingService as jest.Mocked<typeof messagingService>;
const mockLinuxDepsService = jest.mocked(LinuxDepsService.prototype);

// Import the handler to register the event listeners
import '../handlers/linux-deps-handler';

// Get the registered event handlers
const checkLinuxDepsHandler = mockMessagingService.on.mock.calls.find(call => call[0] === 'check-linux-deps')?.[1] as (payload: any, sender: any) => Promise<void>;
const validateSudoPasswordHandler = mockMessagingService.on.mock.calls.find(call => call[0] === 'validate-sudo-password')?.[1] as (payload: any, sender: any) => Promise<void>;
const installLinuxDepsHandler = mockMessagingService.on.mock.calls.find(call => call[0] === 'install-linux-deps')?.[1] as (payload: any, sender: any) => Promise<void>;
const getLinuxDepsListHandler = mockMessagingService.on.mock.calls.find(call => call[0] === 'get-linux-deps-list')?.[1] as (payload: any, sender: any) => void;

const mockSender = {
  send: jest.fn()
} as any as Electron.WebContents;

describe('Linux Deps Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('check-linux-deps event', () => {
    it('should handle undefined payload (payload || {})', async () => {
      mockLinuxDepsService.checkDependencies.mockResolvedValue({ success: true, platform: 'linux', dependencies: [], missing: [], missingRequired: [], allDepsInstalled: true, canProceed: true, message: '' });
      await checkLinuxDepsHandler(undefined, mockSender);
      expect(mockLinuxDepsService.checkDependencies).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-check-result', {
        success: true,
        platform: 'linux',
        dependencies: [],
        missing: [],
        missingRequired: [],
        allDepsInstalled: true,
        canProceed: true,
        message: '',
        requestId: undefined
      });
    });
    it('should handle null payload (payload || {})', async () => {
      mockLinuxDepsService.checkDependencies.mockResolvedValue({ success: true, platform: 'linux', dependencies: [], missing: [], missingRequired: [], allDepsInstalled: true, canProceed: true, message: '' });
      await checkLinuxDepsHandler(null, mockSender);
      expect(mockLinuxDepsService.checkDependencies).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-check-result', {
        success: true,
        platform: 'linux',
        dependencies: [],
        missing: [],
        missingRequired: [],
        allDepsInstalled: true,
        canProceed: true,
        message: '',
        requestId: undefined
      });
    });
    it('should handle check Linux dependencies exception with string error', async () => {
      mockLinuxDepsService.checkDependencies.mockRejectedValue('string error');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await checkLinuxDepsHandler({ requestId: 'err-string' }, mockSender);
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-check-result', { success: false, error: 'Unexpected error', requestId: 'err-string' });
      consoleSpy.mockRestore();
    });
    it('should handle check Linux dependencies exception with undefined error', async () => {
      mockLinuxDepsService.checkDependencies.mockRejectedValue(undefined);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await checkLinuxDepsHandler({ requestId: 'err-undef' }, mockSender);
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-check-result', { success: false, error: 'Unexpected error', requestId: 'err-undef' });
      consoleSpy.mockRestore();
    });
    it('should check Linux dependencies successfully', async () => {
      const payload = { requestId: 'test-123' };
      const expectedResult = {
        success: true,
        platform: 'linux',
        dependencies: [],
        missing: [],
        missingRequired: [],
        allDepsInstalled: true,
        canProceed: true,
        message: 'All Linux dependencies are installed'
      };

      mockLinuxDepsService.checkDependencies.mockResolvedValue(expectedResult);

      await checkLinuxDepsHandler(payload, mockSender);

      expect(mockLinuxDepsService.checkDependencies).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-check-result', {
        success: true,
        platform: 'linux',
        dependencies: [],
        missing: [],
        missingRequired: [],
        allDepsInstalled: true,
        canProceed: true,
        message: 'All Linux dependencies are installed',
        requestId: 'test-123'
      });
    });

    it('should handle check Linux dependencies failure', async () => {
      const payload = { requestId: 'test-123' };
      const expectedResult = {
        success: false,
        platform: 'linux',
        dependencies: [],
        missing: [],
        missingRequired: [],
        allDepsInstalled: false,
        canProceed: false,
        error: 'Check failed'
      };

      mockLinuxDepsService.checkDependencies.mockResolvedValue(expectedResult);

      await checkLinuxDepsHandler(payload, mockSender);

      expect(mockLinuxDepsService.checkDependencies).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-check-result', {
        success: false,
        platform: 'linux',
        dependencies: [],
        missing: [],
        missingRequired: [],
        allDepsInstalled: false,
        canProceed: false,
        error: 'Check failed',
        requestId: 'test-123'
      });
    });

    it('should handle check Linux dependencies exception', async () => {
      const payload = { requestId: 'test-123' };
      const error = new Error('System error');

      mockLinuxDepsService.checkDependencies.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await checkLinuxDepsHandler(payload, mockSender);

      expect(mockLinuxDepsService.checkDependencies).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[linux-deps-handler] Unexpected error:', error);
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-check-result', {
        success: false,
        error: 'System error',
        requestId: 'test-123'
      });

      consoleSpy.mockRestore();
    });
  });

  describe('validate-sudo-password event', () => {
    it('should handle undefined payload (payload || {})', async () => {
      mockLinuxDepsService.validateSudoPassword.mockResolvedValue({ valid: true, error: null });
      await validateSudoPasswordHandler(undefined, mockSender);
      expect(mockLinuxDepsService.validateSudoPassword).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('sudo-password-validation', {
        valid: true,
        error: null,
        requestId: undefined
      });
    });
    it('should handle null payload (payload || {})', async () => {
      mockLinuxDepsService.validateSudoPassword.mockResolvedValue({ valid: true, error: null });
      await validateSudoPasswordHandler(null, mockSender);
      expect(mockLinuxDepsService.validateSudoPassword).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('sudo-password-validation', {
        valid: true,
        error: null,
        requestId: undefined
      });
    });
    it('should handle validate sudo password exception with string error', async () => {
      mockLinuxDepsService.validateSudoPassword.mockRejectedValue('string error');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await validateSudoPasswordHandler({ password: 'err-string', requestId: 'err-string' }, mockSender);
      expect(mockSender.send).toHaveBeenCalledWith('sudo-password-validation', { valid: false, error: 'Unexpected error', requestId: 'err-string' });
      consoleSpy.mockRestore();
    });
    it('should handle validate sudo password exception with undefined error', async () => {
      mockLinuxDepsService.validateSudoPassword.mockRejectedValue(undefined);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await validateSudoPasswordHandler({ password: 'err-undef', requestId: 'err-undef' }, mockSender);
      expect(mockSender.send).toHaveBeenCalledWith('sudo-password-validation', { valid: false, error: 'Unexpected error', requestId: 'err-undef' });
      consoleSpy.mockRestore();
    });
    it('should validate sudo password successfully', async () => {
      const payload = { password: 'correct-password', requestId: 'test-123' };
      const expectedResult = {
        valid: true,
        error: null
      };

      mockLinuxDepsService.validateSudoPassword.mockResolvedValue(expectedResult);

      await validateSudoPasswordHandler(payload, mockSender);

      expect(mockLinuxDepsService.validateSudoPassword).toHaveBeenCalledWith('correct-password');
      expect(mockSender.send).toHaveBeenCalledWith('sudo-password-validation', {
        valid: true,
        error: null,
        requestId: 'test-123'
      });
    });

    it('should handle validate sudo password failure', async () => {
      const payload = { password: 'wrong-password', requestId: 'test-123' };
      const expectedResult = {
        valid: false,
        error: 'Invalid sudo password'
      };

      mockLinuxDepsService.validateSudoPassword.mockResolvedValue(expectedResult);

      await validateSudoPasswordHandler(payload, mockSender);

      expect(mockLinuxDepsService.validateSudoPassword).toHaveBeenCalledWith('wrong-password');
      expect(mockSender.send).toHaveBeenCalledWith('sudo-password-validation', {
        valid: false,
        error: 'Invalid sudo password',
        requestId: 'test-123'
      });
    });

    it('should handle validate sudo password exception', async () => {
      const payload = { password: 'test-password', requestId: 'test-123' };
      const error = new Error('Validation failed');

      mockLinuxDepsService.validateSudoPassword.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await validateSudoPasswordHandler(payload, mockSender);

      expect(mockLinuxDepsService.validateSudoPassword).toHaveBeenCalledWith('test-password');
      expect(consoleSpy).toHaveBeenCalledWith('[linux-deps-handler] Unexpected error validating sudo password:', error);
      expect(mockSender.send).toHaveBeenCalledWith('sudo-password-validation', {
        valid: false,
        error: 'Validation failed',
        requestId: 'test-123'
      });

      consoleSpy.mockRestore();
    });
  });

  describe('install-linux-deps event', () => {
    it('should send progress updates during install', async () => {
      const payload = {
        password: 'progress-password',
        dependencies: [{ name: 'steamcmd', packageName: 'steamcmd', checkCommand: 'which steamcmd', description: 'SteamCMD for ARK server management', required: true }],
        requestId: 'progress-req'
      };
      // Capture the progress callback
      let progressCallback: ((progress: any) => void) | undefined;
      mockLinuxDepsService.installDependencies.mockImplementation(async (_password, _dependencies, cb) => {
        progressCallback = cb;
        // Simulate async install
        return { success: true, message: 'done', details: [] };
      });
      await installLinuxDepsHandler(payload, mockSender);
      // Simulate a progress event
      const progress = { percent: 50, message: 'Halfway' };
      if (progressCallback) progressCallback(progress);
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-install-progress', { percent: 50, message: 'Halfway', requestId: 'progress-req' });
    });
    it('should handle undefined payload (payload || {})', async () => {
      mockLinuxDepsService.installDependencies.mockResolvedValue({ success: true, message: '', details: [] });
      await installLinuxDepsHandler(undefined, mockSender);
      expect(mockLinuxDepsService.installDependencies).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-install-result', {
        success: true,
        message: '',
        details: [],
        requestId: undefined
      });
    });
    it('should handle null payload (payload || {})', async () => {
      mockLinuxDepsService.installDependencies.mockResolvedValue({ success: true, message: '', details: [] });
      await installLinuxDepsHandler(null, mockSender);
      expect(mockLinuxDepsService.installDependencies).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-install-result', {
        success: true,
        message: '',
        details: [],
        requestId: undefined
      });
    });
    it('should handle install Linux dependencies exception with string error', async () => {
  mockLinuxDepsService.installDependencies.mockRejectedValue('string error');
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await installLinuxDepsHandler({ password: 'err-string', dependencies: [], requestId: 'err-string' }, mockSender);
  expect(mockSender.send).toHaveBeenCalledWith('linux-deps-install-result', { success: false, error: 'Unexpected error during installation', details: [], requestId: 'err-string' });
  consoleSpy.mockRestore();
    });
    it('should handle install Linux dependencies exception with undefined error', async () => {
  mockLinuxDepsService.installDependencies.mockRejectedValue(undefined);
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await installLinuxDepsHandler({ password: 'err-undef', dependencies: [], requestId: 'err-undef' }, mockSender);
  expect(mockSender.send).toHaveBeenCalledWith('linux-deps-install-result', { success: false, error: 'Unexpected error during installation', details: [], requestId: 'err-undef' });
  consoleSpy.mockRestore();
    });
    it('should install Linux dependencies successfully', async () => {
      const payload = {
        password: 'correct-password',
        dependencies: [{
          name: 'steamcmd',
          packageName: 'steamcmd',
          checkCommand: 'which steamcmd',
          description: 'SteamCMD for ARK server management',
          required: true
        }],
        requestId: 'test-123'
      };
      const expectedResult = {
        success: true,
        message: 'Dependencies installed successfully',
        details: []
      };

      mockLinuxDepsService.installDependencies.mockResolvedValue(expectedResult);

      await installLinuxDepsHandler(payload, mockSender);

      expect(mockLinuxDepsService.installDependencies).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-install-result', {
        success: true,
        message: 'Dependencies installed successfully',
        details: [],
        requestId: 'test-123'
      });
    });

    it('should handle install Linux dependencies failure', async () => {
      const payload = {
        password: 'wrong-password',
        dependencies: [{
          name: 'steamcmd',
          packageName: 'steamcmd',
          checkCommand: 'which steamcmd',
          description: 'SteamCMD for ARK server management',
          required: true
        }],
        requestId: 'test-123'
      };
      const expectedResult = {
        success: false,
        error: 'Invalid sudo password',
        details: []
      };

      mockLinuxDepsService.installDependencies.mockResolvedValue(expectedResult);

      await installLinuxDepsHandler(payload, mockSender);

      expect(mockLinuxDepsService.installDependencies).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-install-result', {
        success: false,
        error: 'Invalid sudo password',
        details: [],
        requestId: 'test-123'
      });
    });

    it('should handle install Linux dependencies exception', async () => {
      const payload = {
        password: 'test-password',
        dependencies: [{
          name: 'steamcmd',
          packageName: 'steamcmd',
          checkCommand: 'which steamcmd',
          description: 'SteamCMD for ARK server management',
          required: true
        }],
        requestId: 'test-123'
      };
      const error = new Error('Installation failed');

      mockLinuxDepsService.installDependencies.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await installLinuxDepsHandler(payload, mockSender);

      expect(mockLinuxDepsService.installDependencies).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[linux-deps-handler] Unexpected error installing dependencies:', error);
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-install-result', {
        success: false,
        error: 'Installation failed',
        details: [],
        requestId: 'test-123'
      });

      consoleSpy.mockRestore();
    });
  });

  describe('get-linux-deps-list event', () => {
    it('should handle undefined payload (payload || {})', () => {
      mockLinuxDepsService.getAvailableDependencies.mockReturnValue({ dependencies: [], platform: 'linux' });
      getLinuxDepsListHandler(undefined, mockSender);
      expect(mockLinuxDepsService.getAvailableDependencies).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-list', {
        dependencies: [],
        platform: 'linux',
        requestId: undefined
      });
    });
    it('should handle null payload (payload || {})', () => {
      mockLinuxDepsService.getAvailableDependencies.mockReturnValue({ dependencies: [], platform: 'linux' });
      getLinuxDepsListHandler(null, mockSender);
      expect(mockLinuxDepsService.getAvailableDependencies).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-list', {
        dependencies: [],
        platform: 'linux',
        requestId: undefined
      });
    });
    it('should handle get Linux dependencies list exception with string error', () => {
      mockLinuxDepsService.getAvailableDependencies.mockImplementation(() => { throw 'string error'; });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      getLinuxDepsListHandler({ requestId: 'err-string' }, mockSender);
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-list', { dependencies: [], platform: 'unknown', error: 'Unexpected error', requestId: 'err-string' });
      consoleSpy.mockRestore();
    });
    it('should handle get Linux dependencies list exception with undefined error', () => {
      mockLinuxDepsService.getAvailableDependencies.mockImplementation(() => { throw undefined; });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      getLinuxDepsListHandler({ requestId: 'err-undef' }, mockSender);
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-list', { dependencies: [], platform: 'unknown', error: 'Unexpected error', requestId: 'err-undef' });
      consoleSpy.mockRestore();
    });
    it('should get Linux dependencies list successfully', () => {
      const payload = { requestId: 'test-123' };
      const expectedResult = {
        dependencies: [{
          name: 'steamcmd',
          packageName: 'steamcmd',
          checkCommand: 'which steamcmd',
          description: 'SteamCMD for ARK server management',
          required: true
        }],
        platform: 'linux'
      };

      mockLinuxDepsService.getAvailableDependencies.mockReturnValue(expectedResult);

      getLinuxDepsListHandler(payload, mockSender);

      expect(mockLinuxDepsService.getAvailableDependencies).toHaveBeenCalled();
      expect(mockSender.send).toHaveBeenCalled();
    });

    it('should handle get Linux dependencies list exception', () => {
      const payload = { requestId: 'test-123' };
      const error = new Error('List retrieval failed');

      mockLinuxDepsService.getAvailableDependencies.mockImplementation(() => {
        throw error;
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      getLinuxDepsListHandler(payload, mockSender);

      expect(mockLinuxDepsService.getAvailableDependencies).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[linux-deps-handler] Unexpected error getting deps list:', error);
      expect(mockSender.send).toHaveBeenCalledWith('linux-deps-list', {
        dependencies: [],
        platform: 'unknown',
        error: 'List retrieval failed',
        requestId: 'test-123'
      });

      consoleSpy.mockRestore();
    });
  });
});