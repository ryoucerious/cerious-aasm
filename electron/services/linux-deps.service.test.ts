import { LinuxDepsService } from './linux-deps.service';
import * as systemDepsUtils from '../utils/system-deps.utils';
import * as platformUtils from '../utils/platform.utils';

describe('LinuxDepsService', () => {
  let service: LinuxDepsService;

  beforeEach(() => {
    service = new LinuxDepsService();
    jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('checkDependencies returns all installed', async () => {
    jest.spyOn(systemDepsUtils, 'checkAllDependencies').mockResolvedValue([
      { installed: true, dependency: { name: 'dep', packageName: 'pkg', checkCommand: 'cmd', description: 'desc', required: true } }
    ]);
    const result = await service.checkDependencies();
    expect(result.success).toBe(true);
    expect(result.allDepsInstalled).toBe(true);
    expect(result.canProceed).toBe(true);
    expect(result.message).toContain('All Linux dependencies are installed');
  });

  it('checkDependencies returns missing dependencies', async () => {
    jest.spyOn(systemDepsUtils, 'checkAllDependencies').mockResolvedValue([
      { installed: false, dependency: { name: 'dep', packageName: 'pkg', checkCommand: 'cmd', description: 'desc', required: true } }
    ]);
    const result = await service.checkDependencies();
    expect(result.success).toBe(true);
    expect(result.allDepsInstalled).toBe(false);
    expect(result.canProceed).toBe(false);
    expect(result.missing[0].name).toBe('dep');
  });

  it('checkDependencies handles error', async () => {
    jest.spyOn(systemDepsUtils, 'checkAllDependencies').mockRejectedValue(new Error('fail'));
    const result = await service.checkDependencies();
    expect(result.success).toBe(false);
    expect(result.error).toBe('fail');
  });

  it('validateSudoPassword returns valid', async () => {
    jest.spyOn(systemDepsUtils, 'validateSudoPassword').mockResolvedValue(true);
    const result = await service.validateSudoPassword('pass');
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('validateSudoPassword returns invalid', async () => {
    jest.spyOn(systemDepsUtils, 'validateSudoPassword').mockResolvedValue(false);
    const result = await service.validateSudoPassword('pass');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid sudo password');
  });

  it('validateSudoPassword handles error', async () => {
    jest.spyOn(systemDepsUtils, 'validateSudoPassword').mockRejectedValue(new Error('fail'));
    const result = await service.validateSudoPassword('pass');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('fail');
  });

  it('installDependencies returns success on non-linux', async () => {
  jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('windows');
    const result = await service.installDependencies('pass', []);
    expect(result.success).toBe(true);
    expect(result.message).toContain('not required');
  });

  it('installDependencies fails with no password', async () => {
    const result = await service.installDependencies('', []);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Sudo password is required for dependency installation');
  });

  it('installDependencies fails with no dependencies', async () => {
    const result = await service.installDependencies('pass', undefined as any);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Dependencies list is required');
  });

  it('installDependencies fails with invalid password', async () => {
    jest.spyOn(systemDepsUtils, 'validateSudoPassword').mockResolvedValue(false);
    const result = await service.installDependencies('pass', []);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid sudo password');
  });

  it('installDependencies returns result from installMissingDependencies', async () => {
    jest.spyOn(systemDepsUtils, 'validateSudoPassword').mockResolvedValue(true);
  jest.spyOn(systemDepsUtils, 'installMissingDependencies').mockResolvedValue({ success: true, message: 'done', details: [] });
    const result = await service.installDependencies('pass', [{ name: 'dep', packageName: 'pkg', checkCommand: 'cmd', description: 'desc', required: true }]);
    expect(result.success).toBe(true);
  });

  it('installDependencies handles error', async () => {
    jest.spyOn(systemDepsUtils, 'validateSudoPassword').mockResolvedValue(true);
    jest.spyOn(systemDepsUtils, 'installMissingDependencies').mockRejectedValue(new Error('fail'));
    const result = await service.installDependencies('pass', [{ name: 'dep', packageName: 'pkg', checkCommand: 'cmd', description: 'desc', required: true }]);
    expect(result.success).toBe(false);
    expect(result.error).toBe('fail');
  });

  it('getAvailableDependencies returns dependencies and platform', () => {
    (systemDepsUtils as any).LINUX_DEPENDENCIES = [{ name: 'dep', packageName: 'pkg', checkCommand: 'cmd', description: 'desc', required: true }];
    const result = service.getAvailableDependencies();
    expect(result.dependencies[0].name).toBe('dep');
    expect(result.platform).toBe('linux');
  });
});
