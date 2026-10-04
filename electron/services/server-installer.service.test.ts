import * as fs from 'fs';
import { ServerInstallerService, type ServerInstallProgress } from './server-installer.service';
import { getPlatform } from '../utils/platform.utils';
import { checkAllDependencies, installMissingDependencies, type DependencyCheckResult } from '../utils/system-deps.utils';
import { installProton, isProtonInstalled } from '../utils/proton.utils';
import { installSteamCmd, isSteamCmdInstalled } from '../utils/steamcmd.utils';
import { installArkServer } from '../utils/ark/ark-install.utils';
import { onInstallCancel } from '../utils/installer.utils';

jest.mock('../utils/platform.utils', () => ({ getPlatform: jest.fn() }));
jest.mock('../utils/system-deps.utils', () => ({ checkAllDependencies: jest.fn(), installMissingDependencies: jest.fn() }));
jest.mock('../utils/proton.utils', () => ({ isProtonInstalled: jest.fn(), installProton: jest.fn() }));
jest.mock('../utils/steamcmd.utils', () => ({ isSteamCmdInstalled: jest.fn(), installSteamCmd: jest.fn() }));
jest.mock('../utils/ark/ark-install.utils', () => ({ installArkServer: jest.fn() }));
jest.mock('../utils/installer.utils', () => ({ ...jest.requireActual('../utils/installer.utils'), onInstallCancel: jest.fn() }));
jest.mock('../utils/ark/ark-server/ark-server-paths.utils', () => ({
  getArkServerDir: jest.fn(() => '/ark/server'),
  getArkExecutablePath: jest.fn(() => '/ark/server/ark.exe')
}));

const mockDeps = jest.mocked(checkAllDependencies);
const mockInstallDeps = jest.mocked(installMissingDependencies);
const mockOnInstallCancel = jest.mocked(onInstallCancel);

function dependency(name: string, required = true): DependencyCheckResult {
  return { installed: false, dependency: { name, packageName: name.toLowerCase(), checkCommand: 'true', description: name, required } };
}

describe('ServerInstallerService', () => {
  let service: ServerInstallerService;
  let progress: jest.Mock<void, [ServerInstallProgress]>;
  let unregisterCancel: jest.Mock;

  /** What Cancel does to the running install. */
  function cancel(): void {
    mockOnInstallCancel.mock.calls[0][0]();
  }

  function reports(phase: ServerInstallProgress['phase']): Array<Pick<ServerInstallProgress, 'phasePercent' | 'message'>> {
    return progress.mock.calls
      .map(([report]) => report)
      .filter(report => report.phase === phase)
      .map(({ phasePercent, message }) => ({ phasePercent, message }));
  }

  beforeEach(() => {
    service = new ServerInstallerService();
    progress = jest.fn();
    jest.mocked(getPlatform).mockReturnValue('linux');
    mockDeps.mockReset().mockResolvedValue([]);
    mockInstallDeps.mockReset().mockResolvedValue({ success: true, message: 'done', details: [] });
    jest.mocked(isProtonInstalled).mockReturnValue(true);
    jest.mocked(installProton).mockReset().mockImplementation(done => done(null));
    jest.mocked(isSteamCmdInstalled).mockReturnValue(true);
    jest.mocked(installSteamCmd).mockReset().mockImplementation(done => done(null));
    jest.mocked(installArkServer).mockReset().mockImplementation(done => done(null));
    jest.mocked(fs.existsSync).mockReset().mockReturnValue(true);
    unregisterCancel = jest.fn();
    mockOnInstallCancel.mockReset().mockReturnValue(unregisterCancel);
  });

  it('completes when every phase succeeds', async () => {
    const result = await service.installServer(progress, 'pass');

    expect(result.success).toBe(true);
    expect(result.message).toContain('completed successfully');
    expect(result.details.validation.passed).toBe(true);
  });

  it('fails validation when the server executable is missing', async () => {
    jest.mocked(fs.existsSync).mockImplementation(file => file !== '/ark/server/ark.exe');

    const result = await service.installServer(progress, 'pass');

    expect(result.success).toBe(false);
    expect(result.message).toBe('Installation validation failed: ARK server executable not found: /ark/server/ark.exe');
  });

  it('needs the sudo password when required dependencies are missing', async () => {
    mockDeps.mockResolvedValue([dependency('Xvfb')]);

    const result = await service.installServer(progress);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Sudo password required');
    expect(mockInstallDeps).not.toHaveBeenCalled();
  });

  it('installs the missing dependencies by name', async () => {
    mockDeps.mockResolvedValue([dependency('Xvfb'), dependency('Font Configuration', false)]);

    await service.installServer(progress, 'pass');

    expect(mockInstallDeps).toHaveBeenCalledWith(['Xvfb', 'Font Configuration'], 'pass', expect.any(Function), expect.any(AbortSignal));
  });

  it('fails when the dependencies cannot be installed', async () => {
    mockDeps.mockResolvedValue([dependency('Xvfb')]);
    mockInstallDeps.mockResolvedValue({ success: false, message: 'fail', details: ['apt-get install -y xvfb failed'] });

    const result = await service.installServer(progress, 'pass');

    expect(result.success).toBe(false);
    expect(result.message).toBe('Failed to install Linux dependencies: fail\napt-get install -y xvfb failed');
  });

  it('skips the Linux phases on Windows', async () => {
    jest.mocked(getPlatform).mockReturnValue('windows');
    jest.mocked(isProtonInstalled).mockReturnValue(false);

    const result = await service.installServer(progress);

    expect(result.success).toBe(true);
    expect(mockDeps).not.toHaveBeenCalled();
    expect(installProton).not.toHaveBeenCalled();
  });

  it('reports the Proton download as it progresses', async () => {
    jest.mocked(isProtonInstalled).mockReturnValue(false);
    jest.mocked(installProton).mockImplementation((done, onProgress) => {
      onProgress?.({ percent: 40, step: 'download', message: 'Downloading Proton... (40%)' });
      onProgress?.({ percent: 80, step: 'extract', message: 'Download complete. Extracting...' });
      done(null);
    });

    await service.installServer(progress, 'pass');

    expect(reports('proton')).toEqual([
      { phasePercent: 0, message: 'Checking Proton...' },
      { phasePercent: 10, message: 'Installing Proton...' },
      { phasePercent: 40, message: 'Downloading Proton... (40%)' },
      { phasePercent: 80, message: 'Download complete. Extracting...' },
      { phasePercent: 100, message: 'Proton ready' }
    ]);
  });

  it('fails when Proton cannot be installed', async () => {
    jest.mocked(isProtonInstalled).mockReturnValue(false);
    jest.mocked(installProton).mockImplementation(done => done(new Error('socket hang up')));

    const result = await service.installServer(progress, 'pass');

    expect(result.success).toBe(false);
    expect(result.message).toBe('socket hang up');
    expect(installSteamCmd).not.toHaveBeenCalled();
  });

  it('reports SteamCMD progress, never below the phase start', async () => {
    jest.mocked(isSteamCmdInstalled).mockReturnValue(false);
    jest.mocked(installSteamCmd).mockImplementation((done, onProgress) => {
      onProgress?.({ percent: 0, step: 'download', message: 'Downloading SteamCMD...' });
      onProgress?.({ percent: 50, step: 'extract', message: 'Download complete. Extracting...' });
      done(null);
    });

    await service.installServer(progress, 'pass');

    expect(reports('steamcmd')).toEqual(expect.arrayContaining([
      { phasePercent: 10, message: 'Downloading SteamCMD...' },
      { phasePercent: 50, message: 'Download complete. Extracting...' }
    ]));
  });

  it('fails when SteamCMD cannot be installed', async () => {
    jest.mocked(isSteamCmdInstalled).mockReturnValue(false);
    jest.mocked(installSteamCmd).mockImplementation(done => done(new Error('fail')));

    const result = await service.installServer(progress, 'pass');

    expect(result.success).toBe(false);
    expect(result.message).toBe('fail');
  });

  it('reports the ARK download percentage', async () => {
    jest.mocked(installArkServer).mockImplementation((done, onProgress) => {
      onProgress?.({ percent: 42, step: 'downloading', message: 'Downloading Ark Server (42.6%)' });
      done(null);
    });

    await service.installServer(progress, 'pass');

    expect(reports('ark-download')).toContainEqual({ phasePercent: 42, message: 'Downloading Ark Server (42.6%)' });
  });

  describe('Cancel', () => {
    it('ends the install at the next phase once Cancel arrives', async () => {
      jest.mocked(isProtonInstalled).mockReturnValue(false);
      jest.mocked(installProton).mockImplementation(done => {
        cancel();
        done(null);
      });
      jest.mocked(isSteamCmdInstalled).mockReturnValue(false);

      const result = await service.installServer(progress, 'pass');

      expect(result).toEqual(expect.objectContaining({ success: false, message: 'Install cancelled.' }));
      expect(installSteamCmd).not.toHaveBeenCalled();
      expect(installArkServer).not.toHaveBeenCalled();
    });

    it('does not start the ARK download after a cancel during the SteamCMD check', async () => {
      jest.mocked(isSteamCmdInstalled).mockImplementation(() => {
        cancel();
        return true;
      });

      const result = await service.installServer(progress, 'pass');

      expect(result.message).toBe('Install cancelled.');
      expect(installArkServer).not.toHaveBeenCalled();
    });

    it('does not validate after a cancel that lands as the ARK download finishes', async () => {
      jest.mocked(installArkServer).mockImplementation(done => {
        cancel();
        done(null);
      });

      const result = await service.installServer(progress, 'pass');

      expect(result.message).toBe('Install cancelled.');
      expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'validation' }));
    });

    it('stops the dependency install between packages and ends cancelled', async () => {
      mockDeps.mockResolvedValue([dependency('Xvfb'), dependency('cURL')]);
      mockInstallDeps.mockImplementation(async (_names, _password, _onProgress, signal) => {
        cancel();
        expect(signal?.aborted).toBe(true);
        return { success: false, message: 'Install cancelled.', details: [] };
      });

      const result = await service.installServer(progress, 'pass');

      expect(result.message).toBe('Install cancelled.');
      expect(installProton).not.toHaveBeenCalled();
    });

    it('stops listening for Cancel once the install has ended', async () => {
      await service.installServer(progress, 'pass');

      expect(unregisterCancel).toHaveBeenCalledTimes(1);
    });
  });

  it('fails when the ARK server cannot be installed', async () => {
    jest.mocked(installArkServer).mockImplementation(done => done(new Error('Install cancelled.')));

    const result = await service.installServer(progress, 'pass');

    expect(result.success).toBe(false);
    expect(result.message).toBe('Install cancelled.');
  });
});
