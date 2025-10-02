import { 
  checkAllDependencies, 
  installMissingDependencies, 
  validateSudoPassword, 
  LINUX_DEPENDENCIES,
  type DependencyCheckResult,
  type LinuxDepsInstallProgress,
  type LinuxDependency
} from '../utils/system-deps.utils';
import { getPlatform } from '../utils/platform.utils';

/**
 * Linux Dependencies Service
 * Handles Linux dependency checking, validation, and installation
 */
export class LinuxDepsService {

  /**
   * Check for missing Linux dependencies
   * @returns A promise resolving to an object indicating the result of the dependency check
   */
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
      console.error('[Linux Deps Service] Error checking dependencies:', error);
      
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

  /**
   * Validate sudo password
   * @param password - The sudo password to validate
   * @returns A promise resolving to an object indicating the result of the validation
   */
  async validateSudoPassword(password: string): Promise<SudoValidationResult> {
    if (!password) {
      return {
        valid: false,
        error: 'Password is required'
      };
    }

    try {
      const valid = await validateSudoPassword(password);
      return {
        valid,
        error: valid ? null : 'Invalid sudo password'
      };
    } catch (error) {
      console.error('[Linux Deps Service] Error validating sudo password:', error);
      
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Password validation failed'
      };
    }
  }

  /**
   * Install missing Linux dependencies
   * @param password - The sudo password for installation
   * @param dependencies - The list of dependencies to install
   * @param progressCallback - Callback function to receive installation progress updates
   * @returns A promise resolving to an object indicating success or failure of the installation
   */
  async installDependencies(
    password: string, 
    dependencies: LinuxDependency[],
    progressCallback?: (progress: LinuxDepsInstallProgress) => void
  ): Promise<LinuxDepsInstallResult> {
    try {
      if (getPlatform() !== 'linux') {
        return {
          success: true,
          message: 'Linux dependency installation not required on this platform',
          details: []
        };
      }

      if (!password) {
        return {
          success: false,
          error: 'Sudo password is required for dependency installation',
          details: []
        };
      }

      if (!dependencies || !Array.isArray(dependencies)) {
        return {
          success: false,
          error: 'Dependencies list is required',
          details: []
        };
      }

      // First validate the password
      const passwordValid = await validateSudoPassword(password);
      if (!passwordValid) {
        return {
          success: false,
          error: 'Invalid sudo password',
          details: []
        };
      }

      // Install dependencies with progress updates
      const result = await installMissingDependencies(
        dependencies,
        password,
        progressCallback || (() => {})
      );

      return result;

    } catch (error) {
      console.error('[Linux Deps Service] Error installing dependencies:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during installation',
        details: []
      };
    }
  }

  /**
   * Get list of available Linux dependencies
   * @returns A list of available Linux dependencies
   */
  getAvailableDependencies(): LinuxDepsListResult {
    return {
      dependencies: LINUX_DEPENDENCIES,
      platform: getPlatform()
    };
  }
}

// Service Result Interfaces
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
  details: any[];
}

export interface LinuxDepsListResult {
  dependencies: LinuxDependency[];
  platform: string;
}