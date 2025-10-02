import { InstallService } from './install.service';
import * as platformUtils from '../utils/platform.utils';
import * as installerUtils from '../utils/installer.utils';
import * as systemDepsUtils from '../utils/system-deps.utils';
import * as steamcmdUtils from '../utils/steamcmd.utils';
import * as protonUtils from '../utils/proton.utils';
import * as serverInstallerServiceModule from './server-installer.service';

describe('InstallService', () => {
  let service: InstallService;
  let progressCallback: jest.Mock;

  beforeEach(() => {
    jest.spyOn(installerUtils, 'removeInstallLock').mockImplementation(() => {});
    service = new InstallService();
    progressCallback = jest.fn();
    jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
    jest.spyOn(installerUtils, 'isInstallLocked').mockReturnValue(false);
    jest.spyOn(installerUtils, 'createInstallLock').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('checkInstallRequirements returns no requirements for non-server', async () => {
    const result = await service.checkInstallRequirements('steamcmd');
    expect(result.success).toBe(true);
    expect(result.canProceed).toBe(true);
    expect(result.message).toContain('No special requirements');
  });

  it('checkInstallRequirements returns missing dependencies for server', async () => {
    jest.spyOn(systemDepsUtils, 'checkAllDependencies').mockResolvedValue([
      {
        installed: false,
        dependency: {
          name: 'dep1',
          packageName: 'dep1-pkg',
          checkCommand: 'dep1 --version',
          description: 'desc1',
          required: true
        }
      },
      {
        installed: true,
        dependency: {
          name: 'dep2',
          packageName: 'dep2-pkg',
          checkCommand: 'dep2 --version',
          description: 'desc2',
          required: false
        }
      }
    ]);
    const result = await service.checkInstallRequirements('server');
    expect(result.success).toBe(true);
    expect(result.requiresSudo).toBe(true);
    expect(result.canProceed).toBe(false);
    expect(result.missingDependencies[0].name).toBe('dep1');
  });

  it('validateInstallParams validates and sanitizes', () => {
    const result = service.validateInstallParams('server', 'pass');
    expect(result.isValid).toBe(true);
    expect(result.sanitizedTarget).toBeDefined();
  });

  it('validateInstallParams fails for bad target', () => {
    const result = service.validateInstallParams(undefined as any);
    expect(result.isValid).toBe(false);
  });

  it('validateInstallParams fails for bad sudo password', () => {
    const result = service.validateInstallParams('server', 123 as any);
    expect(result.isValid).toBe(false);
  });

  it('installComponent calls correct installer for server', async () => {
    jest.spyOn(service, 'installServerComprehensive').mockResolvedValue({ status: 'success', target: 'server' });
    const result = await service.installComponent('server', progressCallback, 'pass');
    expect(result.status).toBe('success');
    expect(result.target).toBe('server');
  });

  it('installComponent calls correct installer for steamcmd', async () => {
    jest.spyOn(service, 'installSteamCmdComponent').mockResolvedValue({ status: 'success', target: 'steamcmd' });
    const result = await service.installComponent('steamcmd', progressCallback);
    expect(result.status).toBe('success');
    expect(result.target).toBe('steamcmd');
  });

  it('installComponent calls correct installer for proton', async () => {
    jest.spyOn(service, 'installProtonComponent').mockResolvedValue({ status: 'success', target: 'proton' });
    const result = await service.installComponent('proton', progressCallback);
    expect(result.status).toBe('success');
    expect(result.target).toBe('proton');
  });

  it('installComponent returns error for unknown target', async () => {
    const result = await service.installComponent('unknown', progressCallback);
    expect(result.status).toBe('error');
    expect(result.error).toContain('Unknown install target');
  });

  it('cancelInstallation cancels server install', () => {
    jest.spyOn(installerUtils, 'cancelInstaller').mockImplementation(() => {});
    const result = service.cancelInstallation('server');
    expect(result.success).toBe(true);
    expect(result.target).toBe('server');
  });

  it('cancelInstallation fails for non-server', () => {
    const result = service.cancelInstallation('steamcmd');
    expect(result.success).toBe(false);
    expect(result.target).toBe('steamcmd');
  });
});
