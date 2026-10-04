import { InstallService } from './install.service';
import { serverInstallerService, type ServerInstallResult } from './server-installer.service';
import { acquireInstallLock, cancelInstaller, clearStaleInstallLock, INSTALL_IN_PROGRESS, releaseInstallLock } from '../utils/installer.utils';
import { checkAllDependencies, generateInstallInstructions, type DependencyCheckResult } from '../utils/system-deps.utils';
import { installSteamCmd, isSteamCmdInstalled } from '../utils/steamcmd.utils';
import { installProton, isProtonInstalled } from '../utils/proton.utils';
import { getPlatform } from '../utils/platform.utils';
import { areServerFilesUpdating } from '../utils/ark/ark-server/ark-server-state.utils';

jest.mock('./server-installer.service', () => ({ serverInstallerService: { installServer: jest.fn() } }));
jest.mock('../utils/installer.utils', () => ({
  ...jest.requireActual('../utils/installer.utils'),
  acquireInstallLock: jest.fn(),
  releaseInstallLock: jest.fn(),
  clearStaleInstallLock: jest.fn(),
  cancelInstaller: jest.fn()
}));
jest.mock('../utils/system-deps.utils', () => ({
  checkAllDependencies: jest.fn(),
  generateInstallInstructions: jest.fn(() => 'sudo apt-get install xvfb')
}));
jest.mock('../utils/steamcmd.utils', () => ({ isSteamCmdInstalled: jest.fn(), installSteamCmd: jest.fn() }));
jest.mock('../utils/proton.utils', () => ({ isProtonInstalled: jest.fn(), installProton: jest.fn() }));
jest.mock('../utils/platform.utils', () => ({ getPlatform: jest.fn() }));

const mockInstallServer = jest.mocked(serverInstallerService.installServer);
const mockAcquire = jest.mocked(acquireInstallLock);
const mockRelease = jest.mocked(releaseInstallLock);
const mockDeps = jest.mocked(checkAllDependencies);

function dependency(name: string, installed: boolean, required = true): DependencyCheckResult {
  return { installed, dependency: { name, packageName: name, checkCommand: 'true', description: name, required } };
}

function serverResult(success: boolean, message: string): ServerInstallResult {
  const step = { installed: success, message: '' };
  return {
    success,
    message,
    details: { linuxDeps: step, proton: step, steamcmd: step, arkServer: step, validation: { passed: success, message: '' } }
  };
}

describe('InstallService', () => {
  let service: InstallService;
  let progress: jest.Mock;

  beforeEach(() => {
    mockAcquire.mockReset().mockReturnValue(true);
    mockRelease.mockReset();
    mockDeps.mockReset().mockResolvedValue([]);
    mockInstallServer.mockReset();
    jest.mocked(getPlatform).mockReturnValue('linux');
    jest.mocked(isSteamCmdInstalled).mockReturnValue(false);
    jest.mocked(isProtonInstalled).mockReturnValue(false);
    jest.mocked(installSteamCmd).mockReset().mockImplementation(done => done(null));
    jest.mocked(installProton).mockReset().mockImplementation(done => done(null));
    service = new InstallService();
    progress = jest.fn();
  });

  it('clears a lock left behind by a crash when it starts, and only then', () => {
    expect(clearStaleInstallLock).toHaveBeenCalledTimes(1);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  describe('checkInstallRequirements', () => {
    it('has none for components other than the server', async () => {
      const result = await service.checkInstallRequirements('steamcmd');

      expect(result).toEqual(expect.objectContaining({ success: true, canProceed: true, requiresSudo: false }));
      expect(result.message).toContain('No special requirements');
    });

    it('asks for sudo when required Linux dependencies are missing', async () => {
      mockDeps.mockResolvedValue([dependency('Xvfb', false), dependency('cURL', true), dependency('Fonts', false, false)]);

      const result = await service.checkInstallRequirements('server');

      expect(result).toEqual(expect.objectContaining({ success: true, requiresSudo: true, canProceed: false }));
      expect(result.missingDependencies.map(dep => dep.name)).toEqual(['Xvfb']);
    });

    it('reports a failed check', async () => {
      mockDeps.mockRejectedValue(new Error('bash missing'));

      await expect(service.checkInstallRequirements('server')).resolves.toEqual(expect.objectContaining({ success: false, error: 'bash missing' }));
    });
  });

  describe('validateInstallParams', () => {
    it('accepts a target and a string password', () => {
      expect(service.validateInstallParams('server', 'pass')).toEqual({ isValid: true, sanitizedTarget: 'server' });
    });

    it('refuses a missing target', () => {
      expect(service.validateInstallParams(undefined).isValid).toBe(false);
    });

    it('refuses a password that is not a string', () => {
      expect(service.validateInstallParams('server', 123).isValid).toBe(false);
    });
  });

  describe('installComponent', () => {
    it.each(['server', 'steamcmd', 'proton'])('routes %s to its installer', async target => {
      const installers = {
        server: jest.spyOn(service, 'installServerComprehensive').mockResolvedValue({ status: 'success', target: 'server' }),
        steamcmd: jest.spyOn(service, 'installSteamCmdComponent').mockResolvedValue({ status: 'success', target: 'steamcmd' }),
        proton: jest.spyOn(service, 'installProtonComponent').mockResolvedValue({ status: 'success', target: 'proton' })
      };

      await service.installComponent(target, progress, 'pass');

      expect(installers[target as keyof typeof installers]).toHaveBeenCalled();
    });

    it('refuses an unknown target', async () => {
      const result = await service.installComponent('unknown', progress);

      expect(result).toEqual(expect.objectContaining({ status: 'error' }));
      expect(result.error).toContain('Unknown install target');
    });
  });

  describe('server files', () => {
    it('refuses server starts while the server install runs, and only then', async () => {
      let during: boolean | undefined;
      mockInstallServer.mockImplementation(async () => {
        during = areServerFilesUpdating();
        return serverResult(true, 'Installed');
      });

      await service.installServerComprehensive(progress);

      expect(during).toBe(true);
      expect(areServerFilesUpdating()).toBe(false);
    });

    it('lets servers start again after a failed server install', async () => {
      mockInstallServer.mockRejectedValue(new Error('boom'));

      await service.installServerComprehensive(progress);

      expect(areServerFilesUpdating()).toBe(false);
    });
  });

  describe('server', () => {
    it('refuses while another install or update holds the lock', async () => {
      mockAcquire.mockReturnValue(false);

      const result = await service.installServerComprehensive(progress);

      expect(result).toEqual({ status: 'error', target: 'server', error: INSTALL_IN_PROGRESS });
      expect(mockInstallServer).not.toHaveBeenCalled();
      expect(mockRelease).not.toHaveBeenCalled();
    });

    it('forwards phase progress, announces completion and releases the lock', async () => {
      mockInstallServer.mockImplementation(async (onProgress, sudoPassword) => {
        expect(sudoPassword).toBe('pw');
        onProgress({ step: 'steamcmd-install', message: 'Installing SteamCMD...', phase: 'steamcmd', phasePercent: 10, overallPhase: 'Installing SteamCMD' });
        return serverResult(true, 'Server installation completed successfully');
      });

      const result = await service.installServerComprehensive(progress, 'pw');

      expect(progress).toHaveBeenCalledWith({
        phasePercent: 10, step: 'steamcmd-install', message: 'Installing SteamCMD...', phase: 'steamcmd', overallPhase: 'Installing SteamCMD'
      });
      expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
        step: 'complete', phase: 'validation', overallPhase: 'Installation Complete', phasePercent: 100, success: true
      }));
      expect(result).toEqual(expect.objectContaining({ status: 'success', target: 'server', message: 'Server installation completed successfully' }));
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    // The page treats "Installation Complete" as success, and shows `error` when the install fails.
    it('reports a failed install with its reason, and never as complete', async () => {
      mockInstallServer.mockResolvedValue(serverResult(false, 'Install cancelled.'));

      const result = await service.installServerComprehensive(progress);

      expect(result).toEqual(expect.objectContaining({ status: 'error', target: 'server', error: 'Install cancelled.' }));
      expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({ overallPhase: 'Installation Complete' }));
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('releases the lock when the installer throws', async () => {
      mockInstallServer.mockRejectedValue(new Error('boom'));

      await expect(service.installServerComprehensive(progress)).resolves.toEqual({ status: 'error', target: 'server', error: 'boom' });
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });
  });

  describe('SteamCMD', () => {
    it('refuses while another install or update holds the lock', async () => {
      mockAcquire.mockReturnValue(false);

      await expect(service.installSteamCmdComponent(progress)).resolves.toEqual({ status: 'error', target: 'steamcmd', error: INSTALL_IN_PROGRESS });
      expect(installSteamCmd).not.toHaveBeenCalled();
    });

    it('does nothing when SteamCMD is already installed', async () => {
      jest.mocked(isSteamCmdInstalled).mockReturnValue(true);

      const result = await service.installSteamCmdComponent(progress);

      expect(result).toEqual({ status: 'success', target: 'steamcmd', message: 'SteamCMD already installed.' });
      expect(installSteamCmd).not.toHaveBeenCalled();
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('stops with the install command when a required dependency is missing', async () => {
      mockDeps.mockResolvedValue([dependency('Xvfb', false)]);

      const result = await service.installSteamCmdComponent(progress);

      expect(result.status).toBe('error');
      expect(result.error).toContain('Missing required Linux dependencies: Xvfb');
      expect(result.error).toContain('sudo apt-get install xvfb');
      expect(generateInstallInstructions).toHaveBeenCalledWith([expect.objectContaining({ name: 'Xvfb' })]);
      expect(installSteamCmd).not.toHaveBeenCalled();
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('warns about missing optional dependencies and installs', async () => {
      mockDeps.mockResolvedValue([dependency('Fonts', false, false)]);

      const result = await service.installSteamCmdComponent(progress);

      expect(progress).toHaveBeenCalledWith('Warning: Optional dependencies missing: Fonts. Installation will continue.');
      expect(result).toEqual({ status: 'success', target: 'steamcmd', message: 'SteamCMD install completed successfully.' });
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('skips the dependency check on Windows', async () => {
      jest.mocked(getPlatform).mockReturnValue('windows');

      await service.installSteamCmdComponent(progress);

      expect(mockDeps).not.toHaveBeenCalled();
      expect(installSteamCmd).toHaveBeenCalled();
    });

    it('ends cancelled when Cancel arrives during the dependency check', async () => {
      mockDeps.mockImplementation(async () => {
        service.cancelInstallation('steamcmd');
        return [];
      });

      const result = await service.installSteamCmdComponent(progress);

      expect(result).toEqual({ status: 'error', target: 'steamcmd', error: 'Install cancelled.' });
      expect(installSteamCmd).not.toHaveBeenCalled();
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('reports a failed install and releases the lock', async () => {
      jest.mocked(installSteamCmd).mockImplementation(done => done(new Error('socket hang up')));

      const result = await service.installSteamCmdComponent(progress);

      expect(result).toEqual({ status: 'error', target: 'steamcmd', error: 'socket hang up' });
      expect(progress).toHaveBeenCalledWith('Error: socket hang up');
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });
  });

  describe('Proton', () => {
    it('is not needed on Windows', async () => {
      jest.mocked(getPlatform).mockReturnValue('windows');

      const result = await service.installProtonComponent(progress);

      expect(result).toEqual({ status: 'success', target: 'proton', message: 'Proton install is only required on Linux.' });
      expect(installProton).not.toHaveBeenCalled();
    });

    it('refuses while another install or update holds the lock', async () => {
      mockAcquire.mockReturnValue(false);

      await expect(service.installProtonComponent(progress)).resolves.toEqual({ status: 'error', target: 'proton', error: INSTALL_IN_PROGRESS });
    });

    it('installs, forwards progress and releases the lock', async () => {
      jest.mocked(installProton).mockImplementation((done, onProgress) => {
        onProgress?.({ percent: 40, step: 'download', message: 'Downloading Proton... (40%)' });
        done(null);
      });

      const result = await service.installProtonComponent(progress);

      expect(progress).toHaveBeenCalledWith({ percent: 40, step: 'download', message: 'Downloading Proton... (40%)' });
      expect(result).toEqual({ status: 'success', target: 'proton', message: 'Proton install completed successfully.' });
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('ends cancelled when Cancel arrives during the dependency check', async () => {
      mockDeps.mockImplementation(async () => {
        service.cancelInstallation('proton');
        return [];
      });

      const result = await service.installProtonComponent(progress);

      expect(result).toEqual({ status: 'error', target: 'proton', error: 'Install cancelled.' });
      expect(installProton).not.toHaveBeenCalled();
    });

    it('does nothing when Proton is already installed', async () => {
      jest.mocked(isProtonInstalled).mockReturnValue(true);

      await expect(service.installProtonComponent(progress)).resolves.toEqual({ status: 'success', target: 'proton', message: 'Proton already installed.' });
      expect(installProton).not.toHaveBeenCalled();
    });
  });

  describe('cancelInstallation', () => {
    /** Starts a server install that stays running until the returned function is called. */
    function runningServerInstall(): () => Promise<unknown> {
      let finish!: () => void;
      mockInstallServer.mockImplementation(() => new Promise(resolve => {
        finish = () => resolve(serverResult(false, 'Install cancelled.'));
      }));
      const pending = service.installServerComprehensive(progress);
      return async () => {
        finish();
        return pending;
      };
    }

    // The install that is running releases the lock once it has stopped; releasing it here let a
    // second install start while the first was still unwinding.
    it('cancels the running server install and leaves the lock to it', async () => {
      const finish = runningServerInstall();

      expect(service.cancelInstallation('server')).toEqual({ success: true, target: 'server' });

      expect(cancelInstaller).toHaveBeenCalled();
      expect(mockRelease).not.toHaveBeenCalled();
      await finish();
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    // Otherwise a Cancel click could stop a cluster update's SteamCMD run.
    it('cancels nothing when it is not running an install', () => {
      expect(service.cancelInstallation('server')).toEqual({ success: false, target: 'server' });
      expect(cancelInstaller).not.toHaveBeenCalled();
    });

    it('cancels nothing once its install has finished', async () => {
      const finish = runningServerInstall();
      await finish();

      expect(service.cancelInstallation('server')).toEqual({ success: false, target: 'server' });
      expect(cancelInstaller).not.toHaveBeenCalled();
    });

    it('cancels only the target that is installing', async () => {
      const finish = runningServerInstall();

      expect(service.cancelInstallation('steamcmd')).toEqual({ success: false, target: 'steamcmd' });
      expect(cancelInstaller).not.toHaveBeenCalled();
      await finish();
    });

    it('names an unknown target', () => {
      expect(service.cancelInstallation(undefined)).toEqual({ success: false, target: 'unknown' });
    });
  });
});
