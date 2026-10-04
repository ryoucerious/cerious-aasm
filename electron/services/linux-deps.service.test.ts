import { LinuxDepsService } from './linux-deps.service';
import * as systemDepsUtils from '../utils/system-deps.utils';
import { getPlatform } from '../utils/platform.utils';

jest.mock('../utils/platform.utils', () => ({ getPlatform: jest.fn() }));
jest.mock('../utils/system-deps.utils', () => ({
  ...jest.requireActual('../utils/system-deps.utils'),
  checkAllDependencies: jest.fn(),
  installMissingDependencies: jest.fn(),
  validateSudoPassword: jest.fn()
}));

const mockDeps = jest.mocked(systemDepsUtils.checkAllDependencies);
const mockInstall = jest.mocked(systemDepsUtils.installMissingDependencies);
const mockValidate = jest.mocked(systemDepsUtils.validateSudoPassword);

const xvfb = systemDepsUtils.LINUX_DEPENDENCIES.find(dep => dep.name === 'Xvfb')!;

describe('LinuxDepsService', () => {
  let service: LinuxDepsService;

  beforeEach(() => {
    service = new LinuxDepsService();
    jest.mocked(getPlatform).mockReturnValue('linux');
    mockDeps.mockReset();
    mockInstall.mockReset().mockResolvedValue({ success: true, message: 'done', details: [] });
    mockValidate.mockReset().mockResolvedValue(true);
  });

  describe('checkDependencies', () => {
    it('reports everything installed', async () => {
      mockDeps.mockResolvedValue([{ installed: true, dependency: xvfb }]);

      const result = await service.checkDependencies();

      expect(result).toEqual(expect.objectContaining({ success: true, allDepsInstalled: true, canProceed: true }));
      expect(result.message).toContain('All Linux dependencies are installed');
    });

    it('reports what is missing', async () => {
      mockDeps.mockResolvedValue([{ installed: false, dependency: xvfb }]);

      const result = await service.checkDependencies();

      expect(result).toEqual(expect.objectContaining({ success: true, allDepsInstalled: false, canProceed: false }));
      expect(result.missing).toEqual([xvfb]);
    });

    it('reports a failed check', async () => {
      mockDeps.mockRejectedValue(new Error('fail'));

      await expect(service.checkDependencies()).resolves.toEqual(expect.objectContaining({ success: false, error: 'fail' }));
    });

    it('has nothing to check off Linux', async () => {
      jest.mocked(getPlatform).mockReturnValue('windows');

      await expect(service.checkDependencies()).resolves.toEqual(expect.objectContaining({ platform: 'non-linux', canProceed: true }));
      expect(mockDeps).not.toHaveBeenCalled();
    });
  });

  describe('validateSudoPassword', () => {
    it.each([
      [true, { valid: true, error: null }],
      [false, { valid: false, error: 'Invalid sudo password' }]
    ])('reports what sudo said (%p)', async (valid, expected) => {
      mockValidate.mockResolvedValue(valid);

      await expect(service.validateSudoPassword('pass')).resolves.toEqual(expected);
    });

    it('reports a failed validation', async () => {
      mockValidate.mockRejectedValue(new Error('fail'));

      await expect(service.validateSudoPassword('pass')).resolves.toEqual({ valid: false, error: 'fail' });
    });

    it.each([undefined, '', 42])('asks for a password when given %p', async password => {
      await expect(service.validateSudoPassword(password)).resolves.toEqual({ valid: false, error: 'Password is required' });
      expect(mockValidate).not.toHaveBeenCalled();
    });
  });

  describe('installDependencies', () => {
    it('has nothing to install off Linux', async () => {
      jest.mocked(getPlatform).mockReturnValue('windows');

      const result = await service.installDependencies('pass', []);

      expect(result.success).toBe(true);
      expect(result.message).toContain('not required');
    });

    it.each([undefined, '', { toString: () => 'pass' }])('needs a password, refusing %p', async password => {
      await expect(service.installDependencies(password, ['Xvfb'])).resolves.toEqual({
        success: false, error: 'Sudo password is required for dependency installation', details: []
      });
    });

    it('needs a list of dependencies', async () => {
      await expect(service.installDependencies('pass', undefined)).resolves.toEqual({
        success: false, error: 'Dependencies list is required', details: []
      });
    });

    it.each([
      [['Xvfb', 'curl; reboot']],
      [[xvfb]],
      [[{ name: 'Xvfb', packageName: 'curl; reboot' }]]
    ])('refuses anything but known dependency names, before asking sudo: %p', async dependencies => {
      const result = await service.installDependencies('pass', dependencies);

      expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('Unknown dependency') }));
      expect(mockValidate).not.toHaveBeenCalled();
      expect(mockInstall).not.toHaveBeenCalled();
    });

    it('refuses a wrong password', async () => {
      mockValidate.mockResolvedValue(false);

      await expect(service.installDependencies('pass', ['Xvfb'])).resolves.toEqual({ success: false, error: 'Invalid sudo password', details: [] });
      expect(mockInstall).not.toHaveBeenCalled();
    });

    it('installs the named dependencies and passes progress on', async () => {
      const onProgress = jest.fn();

      const result = await service.installDependencies('pass', ['Xvfb', 'cURL'], onProgress);

      expect(result).toEqual({ success: true, message: 'done', details: [] });
      expect(mockInstall).toHaveBeenCalledWith(['Xvfb', 'cURL'], 'pass', onProgress);
    });

    it('reports a failed install', async () => {
      mockInstall.mockRejectedValue(new Error('fail'));

      await expect(service.installDependencies('pass', ['Xvfb'])).resolves.toEqual({ success: false, error: 'fail', details: [] });
    });
  });

  it('lists the known dependencies', () => {
    expect(service.getAvailableDependencies()).toEqual({ dependencies: systemDepsUtils.LINUX_DEPENDENCIES, platform: 'linux' });
  });
});
