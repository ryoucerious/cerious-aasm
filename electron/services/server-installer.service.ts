import * as fs from 'fs';
import { installArkServer } from '../utils/ark/ark-install.utils';
import { getArkExecutablePath, getArkServerDir } from '../utils/ark/ark-server/ark-server-paths.utils';
import { InstallCancelledError, onInstallCancel, type InstallProgress } from '../utils/installer.utils';
import { getPlatform } from '../utils/platform.utils';
import { installProton, isProtonInstalled } from '../utils/proton.utils';
import { installSteamCmd, isSteamCmdInstalled } from '../utils/steamcmd.utils';
import { checkAllDependencies, installMissingDependencies } from '../utils/system-deps.utils';

export interface ServerInstallProgress {
  step: string;
  message: string;
  phase: 'linux-deps' | 'proton' | 'steamcmd' | 'ark-download' | 'validation';
  /** 0-100 within the current phase. */
  phasePercent: number;
  overallPhase: string;
}

export interface ServerInstallResult {
  success: boolean;
  message: string;
  details: {
    linuxDeps: { installed: boolean; message: string };
    proton: { installed: boolean; message: string };
    steamcmd: { installed: boolean; message: string };
    arkServer: { installed: boolean; message: string };
    validation: { passed: boolean; message: string };
  };
}

type Installer = (callback: (err: Error | null) => void, onProgress?: (progress: InstallProgress) => void) => void;

/** Runs a callback-style installer; a failure is also recorded as the phase's message. */
async function install(
  installer: Installer,
  detail: { message: string },
  onProgress: (progress: InstallProgress) => void
): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => installer(err => (err ? reject(err) : resolve()), onProgress));
  } catch (error) {
    detail.message = (error as Error).message;
    throw error;
  }
}

const clampPercent = (percent: number, floor: number) => Math.max(floor, Math.min(percent, 100));

export class ServerInstallerService {
  /**
   * Never rejects: a failed phase ends the install, and the result says which and why. Cancel
   * stops the phase that is running where it can, and otherwise ends the install before the next.
   */
  async installServer(
    onProgress: (progress: ServerInstallProgress) => void,
    sudoPassword?: string
  ): Promise<ServerInstallResult> {
    const result: ServerInstallResult = {
      success: false,
      message: '',
      details: {
        linuxDeps: { installed: false, message: '' },
        proton: { installed: false, message: '' },
        steamcmd: { installed: false, message: '' },
        arkServer: { installed: false, message: '' },
        validation: { passed: false, message: '' }
      }
    };
    const { details } = result;
    const report = (step: string, message: string, phase: ServerInstallProgress['phase'], phasePercent: number, overallPhase: string) =>
      onProgress({ step, message, phase, phasePercent, overallPhase });

    const cancelled = new AbortController();
    const unregisterCancel = onInstallCancel(() => cancelled.abort());
    const checkpoint = () => {
      if (cancelled.signal.aborted) throw new InstallCancelledError();
    };

    try {
      const onLinux = getPlatform() === 'linux';

      report('linux-deps-check', 'Checking Linux dependencies...', 'linux-deps', 0, 'Checking Linux Dependencies');
      if (onLinux) {
        const missing = (await checkAllDependencies()).filter(dep => !dep.installed);
        const missingRequired = missing.filter(dep => dep.dependency.required).map(dep => dep.dependency.name);

        if (missingRequired.length > 0) {
          if (!sudoPassword) {
            details.linuxDeps.message = `Sudo password required to install missing dependencies: ${missingRequired.join(', ')}`;
            throw new Error(`Sudo password required to install missing Linux dependencies: ${missingRequired.join(', ')}. Please check installation requirements first.`);
          }

          report('linux-deps-install', 'Installing Linux dependencies...', 'linux-deps', 10, 'Installing Linux Dependencies');
          const depsResult = await installMissingDependencies(missing.map(dep => dep.dependency.name), sudoPassword, depsProgress => {
            report(`linux-deps-${depsProgress.step}`, depsProgress.message, 'linux-deps', Math.max(10, depsProgress.percent), 'Installing Linux Dependencies');
          }, cancelled.signal);
          checkpoint();
          if (!depsResult.success) {
            details.linuxDeps.message = depsResult.message;
            const detailLines = depsResult.details.length > 0 ? '\n' + depsResult.details.join('\n') : '';
            throw new Error(`Failed to install Linux dependencies: ${depsResult.message}${detailLines}`);
          }
          details.linuxDeps.message = depsResult.message;
        } else {
          details.linuxDeps.message = 'All required Linux dependencies are already installed';
        }
      } else {
        details.linuxDeps.message = 'Linux dependencies not required on this platform';
      }
      details.linuxDeps.installed = true;
      report('linux-deps-complete', 'Linux dependencies ready', 'linux-deps', 100, 'Installing Linux Dependencies');

      checkpoint();
      report('proton-check', 'Checking Proton...', 'proton', 0, 'Installing Proton');
      if (!onLinux) {
        details.proton.message = 'Proton not required on this platform';
      } else if (isProtonInstalled()) {
        details.proton.message = 'Proton already installed';
      } else {
        report('proton-install', 'Installing Proton...', 'proton', 10, 'Installing Proton');
        await install(installProton, details.proton, progress => {
          report('proton-install', progress.message, 'proton', clampPercent(progress.percent, 10), 'Installing Proton');
        });
        details.proton.message = 'Proton installed successfully';
      }
      details.proton.installed = true;
      report('proton-complete', 'Proton ready', 'proton', 100, 'Installing Proton');

      checkpoint();
      report('steamcmd-check', 'Checking SteamCMD...', 'steamcmd', 0, 'Installing SteamCMD');
      if (isSteamCmdInstalled()) {
        details.steamcmd.message = 'SteamCMD already installed';
      } else {
        report('steamcmd-install', 'Installing SteamCMD...', 'steamcmd', 10, 'Installing SteamCMD');
        await install(installSteamCmd, details.steamcmd, progress => {
          report('steamcmd-install', progress.message, 'steamcmd', clampPercent(progress.percent, 10), 'Installing SteamCMD');
        });
        details.steamcmd.message = 'SteamCMD installed successfully';
      }
      details.steamcmd.installed = true;
      report('steamcmd-complete', 'SteamCMD ready', 'steamcmd', 100, 'Installing SteamCMD');

      checkpoint();
      report('ark-download-start', 'Starting ARK server download...', 'ark-download', 0, 'Downloading ARK Server');
      await install(installArkServer, details.arkServer, progress => {
        report('ark-download', progress.message, 'ark-download', clampPercent(progress.percent, 0), 'Downloading ARK Server');
      });
      details.arkServer.installed = true;
      details.arkServer.message = 'ARK server installed successfully';
      report('ark-download-complete', 'ARK server download complete', 'ark-download', 100, 'Downloading ARK Server');

      checkpoint();
      report('validation-start', 'Validating installation...', 'validation', 0, 'Validating Installation');
      const problem = this.findInstallProblem();
      if (problem) {
        details.validation.message = problem;
        throw new Error(`Installation validation failed: ${problem}`);
      }
      details.validation.passed = true;
      details.validation.message = 'Installation validation successful';
      report('validation-complete', 'Installation validated successfully', 'validation', 100, 'Validating Installation');

      result.success = true;
      result.message = 'Server installation completed successfully';
      return result;
    } catch (error) {
      result.message = error instanceof Error ? error.message : String(error);
      console.error('[server-installer] Installation failed:', result.message);
      return result;
    } finally {
      unregisterCancel();
    }
  }

  private findInstallProblem(): string | null {
    const serverDir = getArkServerDir();
    if (!fs.existsSync(serverDir)) {
      return `ARK server directory not found: ${serverDir}`;
    }
    const executable = getArkExecutablePath();
    if (!fs.existsSync(executable)) {
      return `ARK server executable not found: ${executable}`;
    }
    return null;
  }
}

export const serverInstallerService = new ServerInstallerService();
