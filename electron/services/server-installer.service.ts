import { isSteamCmdInstalled, installSteamCmd } from '../utils/steamcmd.utils';
import { isProtonInstalled, installProton } from '../utils/proton.utils';
import { ArkPathUtils } from '../utils/ark.utils';
import { installArkServer } from '../utils/ark.utils';
import { checkAllDependencies, installMissingDependencies, type LinuxDependency, type DependencyCheckResult } from '../utils/system-deps.utils';
import { getPlatform } from '../utils/platform.utils';

export interface ServerInstallProgress {
  step: string;
  message: string;
  phase: 'linux-deps' | 'proton' | 'steamcmd' | 'ark-download' | 'validation';
  phasePercent: number; // The 0-100% progress for THIS specific phase
  overallPhase: string; // Human readable description of current phase
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

export class ServerInstallerService {
  
  // Helper to create progress with just phase tracking
  private createProgress(
    step: string,
    message: string,
    phase: ServerInstallProgress['phase'],
    phasePercent: number,
    overallPhase: string
  ): ServerInstallProgress {
    return {
      step,
      message,
      phase,
      phasePercent,
      overallPhase
    };
  }

  /**
   * Install the game server and its dependencies
   * @param onProgress - Callback to receive progress updates
   * @param sudoPassword - Optional sudo password for installing dependencies
   * @returns A promise resolving to the result of the installation
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

    try {
      const platform = getPlatform();
      
      // Phase 1: Check and install Linux dependencies on Linux only
      onProgress(this.createProgress('linux-deps-check', 'Checking Linux dependencies...', 'linux-deps', 0, 'Checking Linux Dependencies'));
      
      if (platform === 'linux') {
        const depStatus = await checkAllDependencies();
        const missingDeps = depStatus.filter((d: DependencyCheckResult) => !d.installed);
        const missingRequired = missingDeps.filter((d: DependencyCheckResult) => d.dependency.required);
        
        if (missingRequired.length > 0) {
          if (!sudoPassword) {
            result.details.linuxDeps.message = `Sudo password required to install missing dependencies: ${missingRequired.map(d => d.dependency.name).join(', ')}`;
            throw new Error(`Sudo password required to install missing Linux dependencies: ${missingRequired.map(d => d.dependency.name).join(', ')}. Please check installation requirements first.`);
          }
          
          onProgress(this.createProgress('linux-deps-install', 'Installing Linux dependencies...', 'linux-deps', 10, 'Installing Linux Dependencies'));
          
          const depsResult = await installMissingDependencies(
            missingDeps.map(d => d.dependency),
            sudoPassword,
            (depsProgress) => {
              onProgress(this.createProgress(
                `linux-deps-${depsProgress.step}`,
                depsProgress.message,
                'linux-deps',
                Math.max(10, depsProgress.percent),
                'Installing Linux Dependencies'
              ));
            }
          );
          
          if (!depsResult.success) {
            result.details.linuxDeps.message = depsResult.message;
            const detailLines = depsResult.details.length > 0 ? '\n' + depsResult.details.join('\n') : '';
            throw new Error(`Failed to install Linux dependencies: ${depsResult.message}${detailLines}`);
          }
          
          result.details.linuxDeps.installed = true;
          result.details.linuxDeps.message = depsResult.message;
        } else {
          result.details.linuxDeps.installed = true;
          result.details.linuxDeps.message = 'All required Linux dependencies are already installed';
        }
      } else {
        result.details.linuxDeps.installed = true;
        result.details.linuxDeps.message = 'Linux dependencies not required on this platform';
      }

      onProgress(this.createProgress('linux-deps-complete', 'Linux dependencies ready', 'linux-deps', 100, 'Installing Linux Dependencies'));

      // Phase 1.5: Install Proton on Linux - Only reports 0% -> 100% completion, no granular progress
      onProgress(this.createProgress('proton-check', 'Checking Proton...', 'proton', 0, 'Installing Proton'));
      
      if (platform === 'linux') {
        if (!isProtonInstalled()) {
          onProgress(this.createProgress('proton-install', 'Installing Proton...', 'proton', 10, 'Installing Proton'));
          
          await new Promise<void>((resolve, reject) => {
            installProton((err) => {
              if (err) {
                result.details.proton.message = err.message;
                reject(err);
              } else {
                result.details.proton.installed = true;
                result.details.proton.message = 'Proton installed successfully';
                resolve();
              }
            }, (progress) => {
              // Parse proton progress if needed - assume it gives us some percentage
              const percent = Math.min(10 + (progress.length % 80), 100);
              onProgress(this.createProgress('proton-install', 'Installing Proton...', 'proton', percent, 'Installing Proton'));
            });
          });
        } else {
          result.details.proton.installed = true;
          result.details.proton.message = 'Proton already installed';
        }
      } else {
        result.details.proton.installed = true;
        result.details.proton.message = 'Proton not required on this platform';
      }

      onProgress(this.createProgress('proton-complete', 'Proton ready', 'proton', 100, 'Installing Proton'));

      // Phase 2: Install SteamCMD - Reports its own 0-100% progress
      onProgress(this.createProgress('steamcmd-check', 'Checking SteamCMD...', 'steamcmd', 0, 'Installing SteamCMD'));
      
      if (!isSteamCmdInstalled()) {
        onProgress(this.createProgress('steamcmd-install', 'Installing SteamCMD...', 'steamcmd', 10, 'Installing SteamCMD'));
        
        await new Promise<void>((resolve, reject) => {
          installSteamCmd((err) => {
            if (err) {
              result.details.steamcmd.message = err.message;
              reject(err);
            } else {
              result.details.steamcmd.installed = true;
              result.details.steamcmd.message = 'SteamCMD installed successfully';
              resolve();
            }
          }, (progress: any) => {
            // SteamCMD progress may be a string or an object; handle both safely
            let percent = 50;
            let message = '';
            if (progress && typeof progress === 'object') {
              if (typeof progress.percent === 'number') percent = Math.max(10, Math.min(progress.percent, 100));
              message = progress.message || (progress.step ? String(progress.step) : 'Installing SteamCMD...');
            } else {
              message = String(progress || 'Installing SteamCMD...');
              const percentMatch = message.match(/(\d+)%/);
              if (percentMatch) {
                percent = Math.max(10, Math.min(parseInt(percentMatch[1], 10), 100));
              }
            }
            onProgress(this.createProgress('steamcmd-install', message, 'steamcmd', percent, 'Installing SteamCMD'));
          });
        });
      } else {
        result.details.steamcmd.installed = true;
        result.details.steamcmd.message = 'SteamCMD already installed';
      }

      onProgress(this.createProgress('steamcmd-complete', 'SteamCMD ready', 'steamcmd', 100, 'Installing SteamCMD'));

      // Phase 3: Download/Install ARK Server - Reports 0-100% progress from Steam
      onProgress(this.createProgress('ark-download-start', 'Starting ARK server download...', 'ark-download', 0, 'Downloading ARK Server'));
      
      await new Promise<void>((resolve, reject) => {
        installArkServer((err) => {
          if (err) {
            result.details.arkServer.message = err.message;
            reject(err);
          } else {
            result.details.arkServer.installed = true;
            result.details.arkServer.message = 'ARK server installed successfully';
            resolve();
          }
        }, (progress: any) => {
          // ARK download progress may be a string or an object; handle both safely
          let percent = 0;
          let message = '';
          if (progress && typeof progress === 'object') {
            if (typeof progress.percent === 'number') percent = Math.max(0, Math.min(progress.percent, 100));
            message = progress.message || (progress.step ? String(progress.step) : 'Downloading ARK server...');
          } else {
            message = String(progress || 'Downloading ARK server...');
            const percentMatch = message.match(/(\d+)%/);
            if (percentMatch) {
              percent = Math.max(0, Math.min(parseInt(percentMatch[1], 10), 100));
            }
          }
          onProgress(this.createProgress('ark-download', message, 'ark-download', percent, 'Downloading ARK Server'));
        });
      });

      onProgress(this.createProgress('ark-download-complete', 'ARK server download complete', 'ark-download', 100, 'Downloading ARK Server'));

      // Phase 4: Validation - Quick validation that everything is accessible
      onProgress(this.createProgress('validation-start', 'Validating installation...', 'validation', 0, 'Validating Installation'));
      
      try {
        // Check if ARK server executable exists and is accessible
        const arkServerDir = ArkPathUtils.getArkServerDir();
        const arkExecutable = ArkPathUtils.getArkExecutablePath();
        
        // Simple validation: check if the directories and files exist
        const fs = require('fs-extra');
        
        if (!fs.existsSync(arkServerDir)) {
          throw new Error(`ARK server directory not found: ${arkServerDir}`);
        }
        
        if (!fs.existsSync(arkExecutable)) {
          throw new Error(`ARK server executable not found: ${arkExecutable}`);
        }
        
        result.details.validation.passed = true;
        result.details.validation.message = 'Installation validation successful';
        
        onProgress(this.createProgress('validation-complete', 'Installation validated successfully', 'validation', 100, 'Validating Installation'));
        
      } catch (validationError: any) {
        result.details.validation.message = validationError.message;
        throw new Error(`Installation validation failed: ${validationError.message}`);
      }

      // Success!
      result.success = true;
      result.message = 'Server installation completed successfully';
      return result;

    } catch (error: any) {
      result.success = false;
      result.message = error.message;
      console.error('[Server Installer] Installation failed:', error);
      return result;
    }
  }
}

// Export singleton instance
export const serverInstallerService = new ServerInstallerService();