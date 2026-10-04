import {
  checkAllDependencies,
  findDependencies,
  installMissingDependencies,
  validateSudoPassword,
  LINUX_DEPENDENCIES,
  type DependencyCheckResult,
  type LinuxDepsInstallProgress,
  type LinuxDependency
} from '../utils/system-deps.utils';
import { getPlatform } from '../utils/platform.utils';

export interface LinuxDepsCheckResult {
  success: boolean;
  platform: string;
  dependencies: DependencyCheckResult[];
  missing: LinuxDependency[];
  missingRequired: LinuxDependency[];
  allDepsInstalled: boolean;
  canProceed: boolean;
  message?: string;
  error?: string;
}

export interface SudoValidationResult {
  valid: boolean;
  error?: string | null;
}

export interface LinuxDepsInstallResult {
  success: boolean;
  message?: string;
  error?: string;
  details: string[];
}

export interface LinuxDepsListResult {
  dependencies: LinuxDependency[];
  platform: string;
}

export class LinuxDepsService {
  async checkDependencies(): Promise<LinuxDepsCheckResult> {
    try {
      if (getPlatform() !== 'linux') {
        return {
          success: true,
          platform: 'non-linux',
          dependencies: [],
          missing: [],
          missingRequired: [],
          allDepsInstalled: true,
          canProceed: true,
          message: 'Linux dependency check not required on this platform'
        };
      }

      const results = await checkAllDependencies();
      const missing = results.filter(r => !r.installed);
      const missingRequired = missing.filter(r => r.dependency.required);

      return {
        success: true,
        platform: 'linux',
        dependencies: results,
        missing: missing.map(r => r.dependency),
        missingRequired: missingRequired.map(r => r.dependency),
        allDepsInstalled: missing.length === 0,
        canProceed: missingRequired.length === 0,
        message: missing.length === 0
          ? 'All Linux dependencies are installed'
          : `Missing ${missing.length} dependencies (${missingRequired.length} required)`
      };
    } catch (error) {
      console.error('[linux-deps] Could not check the dependencies:', error);
      return {
        success: false,
        platform: getPlatform(),
        dependencies: [],
        missing: [],
        missingRequired: [],
        allDepsInstalled: false,
        canProceed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async validateSudoPassword(password: unknown): Promise<SudoValidationResult> {
    if (typeof password !== 'string' || !password) {
      return { valid: false, error: 'Password is required' };
    }

    try {
      const valid = await validateSudoPassword(password);
      return { valid, error: valid ? null : 'Invalid sudo password' };
    } catch (error) {
      console.error('[linux-deps] Could not validate the sudo password:', error instanceof Error ? error.message : error);
      return { valid: false, error: error instanceof Error ? error.message : 'Password validation failed' };
    }
  }

  /**
   * Installs dependencies named as in LINUX_DEPENDENCIES. Only names are accepted: the package
   * names and commands come from that list, never from the caller, because they run as root.
   */
  async installDependencies(
    password: unknown,
    dependencyNames: unknown,
    progressCallback?: (progress: LinuxDepsInstallProgress) => void
  ): Promise<LinuxDepsInstallResult> {
    try {
      if (getPlatform() !== 'linux') {
        return { success: true, message: 'Linux dependency installation not required on this platform', details: [] };
      }
      if (typeof password !== 'string' || !password) {
        return { success: false, error: 'Sudo password is required for dependency installation', details: [] };
      }
      if (!Array.isArray(dependencyNames)) {
        return { success: false, error: 'Dependencies list is required', details: [] };
      }
      const dependencies = findDependencies(dependencyNames);
      if (!dependencies) {
        return { success: false, error: 'Unknown dependency. Use the names get-linux-deps-list returns.', details: [] };
      }
      if (!(await validateSudoPassword(password))) {
        return { success: false, error: 'Invalid sudo password', details: [] };
      }

      return await installMissingDependencies(dependencies.map(dep => dep.name), password, progressCallback ?? (() => {}));
    } catch (error) {
      console.error('[linux-deps] Could not install the dependencies:', error instanceof Error ? error.message : error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during installation',
        details: []
      };
    }
  }

  getAvailableDependencies(): LinuxDepsListResult {
    return { dependencies: LINUX_DEPENDENCIES, platform: getPlatform() };
  }
}
