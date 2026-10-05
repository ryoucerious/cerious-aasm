import {
  acquireInstallLock,
  cancelInstaller,
  clearStaleInstallLock,
  INSTALL_CANCELLED,
  INSTALL_IN_PROGRESS,
  releaseInstallLock,
  type InstallProgress
} from '../utils/installer.utils';
import { getPlatform } from '../utils/platform.utils';
import { whileServerFilesUpdate } from '../utils/ark/ark-server/ark-server-state.utils';
import { installProton, isProtonInstalled } from '../utils/proton.utils';
import { installSteamCmd, isSteamCmdInstalled } from '../utils/steamcmd.utils';
import { checkAllDependencies, generateInstallInstructions, type LinuxDependency } from '../utils/system-deps.utils';
import { sanitizeString } from '../utils/validation.utils';
import { serverInstallerService, type ServerInstallProgress, type ServerInstallResult } from './server-installer.service';

export interface InstallRequirementsResult {
  success: boolean;
  requiresSudo: boolean;
  missingDependencies: LinuxDependency[];
  canProceed: boolean;
  message: string;
  error?: string;
}

interface InstallCompleteReport extends ServerInstallProgress {
  success: true;
  details: ServerInstallResult['details'];
}

/** A server install reports phases; SteamCMD and Proton report plain progress, and lines of text around it. */
export type InstallProgressReport = string | InstallProgress | ServerInstallProgress | InstallCompleteReport;
export type InstallProgressCallback = (progress: InstallProgressReport) => void;

export interface InstallResult {
  status: 'success' | 'error';
  target: string;
  message?: string;
  error?: string;
  details?: ServerInstallResult['details'];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class InstallService {
  /** The install this service is running, which is the only one Cancel may stop. */
  private active: { target: string; cancelled: boolean } | null = null;

  constructor() {
    // A lock left behind by a crash would block every install until it was deleted by hand.
    clearStaleInstallLock();
  }

  async checkInstallRequirements(target: unknown): Promise<InstallRequirementsResult> {
    try {
      if (target === 'server' && getPlatform() === 'linux') {
        const missingRequired = (await checkAllDependencies())
          .filter(result => !result.installed && result.dependency.required)
          .map(result => result.dependency);
        if (missingRequired.length > 0) {
          return {
            success: true,
            requiresSudo: true,
            missingDependencies: missingRequired,
            canProceed: false,
            message: `Missing required Linux dependencies: ${missingRequired.map(dep => dep.name).join(', ')}. Sudo password required for installation.`
          };
        }
      }

      return {
        success: true,
        requiresSudo: false,
        missingDependencies: [],
        canProceed: true,
        message: target === 'server' ? 'All installation requirements met' : 'No special requirements for this installation'
      };
    } catch (error) {
      return {
        success: false,
        requiresSudo: false,
        missingDependencies: [],
        canProceed: false,
        message: '',
        error: error instanceof Error ? error.message : 'Unknown error during requirements check'
      };
    }
  }

  validateInstallParams(target: unknown, sudoPassword?: unknown): { isValid: boolean; error?: string; sanitizedTarget?: string } {
    if (!target || typeof target !== 'string') {
      return { isValid: false, error: 'Invalid install target' };
    }
    if (sudoPassword !== undefined && sudoPassword !== null && typeof sudoPassword !== 'string') {
      return { isValid: false, error: 'Invalid sudo password format' };
    }
    return { isValid: true, sanitizedTarget: sanitizeString(target) };
  }

  async installComponent(target: unknown, progressCallback: InstallProgressCallback, sudoPassword?: unknown): Promise<InstallResult> {
    const validation = this.validateInstallParams(target, sudoPassword);
    if (!validation.isValid) {
      return { status: 'error', target: typeof target === 'string' && target ? target : 'unknown', error: validation.error };
    }

    const sanitizedTarget = validation.sanitizedTarget!;
    switch (sanitizedTarget) {
      case 'server':
        return this.installServerComprehensive(progressCallback, typeof sudoPassword === 'string' ? sudoPassword : undefined);
      case 'steamcmd':
        return this.installSteamCmdComponent(progressCallback);
      case 'proton':
        return this.installProtonComponent(progressCallback);
      default:
        return { status: 'error', target: sanitizedTarget, error: `Unknown install target: ${sanitizedTarget}` };
    }
  }

  /** Linux dependencies, Proton, SteamCMD and the ARK server, in that order. */
  async installServerComprehensive(progressCallback: InstallProgressCallback, sudoPassword?: string): Promise<InstallResult> {
    return this.withInstallLock('server', async () => {
      let result: ServerInstallResult;
      try {
        result = await whileServerFilesUpdate(() => serverInstallerService.installServer(progressCallback, sudoPassword));
      } catch (error) {
        return { status: 'error', target: 'server', error: describeError(error) };
      }

      // The settings page takes "Installation Complete" as success, so it is sent only on success.
      if (!result.success) {
        return { status: 'error', target: 'server', error: result.message, message: result.message, details: result.details };
      }
      progressCallback({
        phasePercent: 100,
        step: 'complete',
        message: result.message,
        phase: 'validation',
        overallPhase: 'Installation Complete',
        success: true,
        details: result.details
      });
      return { status: 'success', target: 'server', message: result.message, details: result.details };
    });
  }

  async installSteamCmdComponent(progressCallback: InstallProgressCallback): Promise<InstallResult> {
    return this.withInstallLock('steamcmd', async () => {
      if (isSteamCmdInstalled()) {
        progressCallback('SteamCMD already installed.');
        return { status: 'success', target: 'steamcmd', message: 'SteamCMD already installed.' };
      }

      if (getPlatform() === 'linux') {
        const missing = await this.checkLinuxDependencies('SteamCMD', progressCallback);
        if (missing) {
          return { status: 'error', target: 'steamcmd', error: missing };
        }
      }
      if (this.active?.cancelled) {
        return { status: 'error', target: 'steamcmd', error: INSTALL_CANCELLED };
      }

      return new Promise<InstallResult>(resolve => {
        installSteamCmd(err => {
          if (err) {
            progressCallback(`Error: ${err.message}`);
            resolve({ status: 'error', target: 'steamcmd', error: err.message });
            return;
          }
          const message = 'SteamCMD install completed successfully.';
          progressCallback(message);
          resolve({ status: 'success', target: 'steamcmd', message });
        }, progressCallback);
      });
    });
  }

  async installProtonComponent(progressCallback: InstallProgressCallback): Promise<InstallResult> {
    if (getPlatform() !== 'linux') {
      const message = 'Proton install is only required on Linux.';
      progressCallback(message);
      return { status: 'success', target: 'proton', message };
    }

    return this.withInstallLock('proton', async () => {
      if (isProtonInstalled()) {
        const message = 'Proton already installed.';
        progressCallback(message);
        return { status: 'success', target: 'proton', message };
      }

      const missing = await this.checkLinuxDependencies('Proton', progressCallback);
      if (missing) {
        return { status: 'error', target: 'proton', error: missing };
      }
      if (this.active?.cancelled) {
        return { status: 'error', target: 'proton', error: INSTALL_CANCELLED };
      }

      return new Promise<InstallResult>(resolve => {
        installProton(err => {
          if (err) {
            progressCallback(`Error: ${err.message}`);
            resolve({ status: 'error', target: 'proton', error: err.message });
            return;
          }
          const message = 'Proton install completed successfully.';
          progressCallback(message);
          resolve({ status: 'success', target: 'proton', message });
        }, progressCallback);
      });
    });
  }

  /**
   * Stops the install of `target` this service is running; anything else holding the install
   * lock (a cluster update, a build check) is left alone. The install releases the lock itself
   * once it has stopped, so a new one cannot start while it is still unwinding.
   */
  cancelInstallation(target: unknown): { success: boolean; target: string } {
    const name = typeof target === 'string' ? target : 'unknown';
    if (!this.active || this.active.target !== target) {
      return { success: false, target: name };
    }
    this.active.cancelled = true;
    cancelInstaller();
    return { success: true, target: name };
  }

  private async withInstallLock(target: string, install: () => Promise<InstallResult>): Promise<InstallResult> {
    if (!acquireInstallLock()) {
      return { status: 'error', target, error: INSTALL_IN_PROGRESS };
    }
    this.active = { target, cancelled: false };
    try {
      return await install();
    } finally {
      this.active = null;
      releaseInstallLock();
    }
  }

  /** Reports the check as it goes. Returns why the install cannot go ahead, or null when it can. */
  private async checkLinuxDependencies(component: string, progressCallback: InstallProgressCallback): Promise<string | null> {
    progressCallback(`Checking Linux dependencies for ${component} installation...`);
    try {
      const missing = (await checkAllDependencies()).filter(result => !result.installed);
      const missingRequired = missing.filter(result => result.dependency.required);
      if (missingRequired.length > 0) {
        const names = missingRequired.map(result => result.dependency.name).join(', ');
        const instructions = generateInstallInstructions(missingRequired.map(result => result.dependency));
        const error = `Missing required Linux dependencies: ${names}\n\n${instructions}`;
        progressCallback(`Error: ${error}`);
        return error;
      }
      if (missing.length > 0) {
        const names = missing.map(result => result.dependency.name).join(', ');
        progressCallback(`Warning: Optional dependencies missing: ${names}. Installation will continue.`);
      }
      progressCallback(`All required dependencies satisfied. Starting ${component} installation...`);
      return null;
    } catch (error) {
      const message = `Could not check the Linux dependencies: ${describeError(error)}`;
      progressCallback(`Error: ${message}`);
      return message;
    }
  }
}

export const installService = new InstallService();
