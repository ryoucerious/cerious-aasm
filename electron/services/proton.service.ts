import { installProton, isProtonInstalled, getProtonDir } from '../utils/proton.utils';
import { getPlatform } from '../utils/platform.utils';

/**
 * Proton Service
 * Handles Proton installation and management for Linux platforms
 */
export class ProtonService {

  /**
   * Check if Proton is installed (Linux only)
   * @returns A promise resolving to an object indicating if Proton is installed
   */
  async checkProtonInstalled(): Promise<ProtonCheckResult> {
    try {
      if (getPlatform() !== 'linux') {
        return { 
          success: true, 
          installed: true, 
          message: 'Proton not needed on Windows',
          path: null
        };
      }
      
      const installed = isProtonInstalled();
      
      return { 
        success: true, 
        installed,
        path: installed ? getProtonDir() : null,
        message: installed ? 'Proton is installed' : 'Proton not installed'
      };
    } catch (error) {
      console.error('[Proton Service] Error checking Proton installation:', error);
      
      return { 
        success: false, 
        installed: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        path: null
      };
    }
  }

  /**
   * @param progressCallback - Optional callback to receive progress updates during installation
   * @returns A promise resolving to an object indicating the result of the installation
   */
  async installProton(progressCallback?: (data: string) => void): Promise<ProtonInstallResult> {
    try {
      if (getPlatform() !== 'linux') {
        return { 
          success: true, 
          message: 'Proton not needed on Windows' 
        };
      }
      
      if (isProtonInstalled()) {
        return { 
          success: true, 
          message: 'Proton is already installed' 
        };
      }
      
      return new Promise((resolve) => {
        installProton(
          (err, output) => {
            if (err) {
              console.error('[Proton Service] Proton installation failed:', err);
              resolve({ 
                success: false, 
                error: err.message || 'Unknown error during Proton installation' 
              });
            } else {
              resolve({ 
                success: true, 
                message: 'Proton installed successfully',
                output 
              });
            }
          },
          (data) => {            
            // Call progress callback if provided
            if (progressCallback) {
              progressCallback(data);
            }
          }
        );
      });
    } catch (error) {
      console.error('[Proton Service] Error starting Proton installation:', error);
      
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Get the Proton directory path.
   * @returns A promise resolving to an object containing the Proton directory path
   */
  async getProtonDirectory(): Promise<ProtonDirectoryResult> {
    try {
      const path = getProtonDir();
      
      return { 
        success: true, 
        path 
      };
    } catch (error) {
      console.error('[Proton Service] Error getting Proton directory:', error);
      
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        path: null
      };
    }
  }

  /**
   * Get platform information and Proton readiness
   * @returns A promise resolving to an object containing platform info and Proton status
   */
  async getPlatformInfo(): Promise<PlatformInfoResult> {
    try {
      const platform = getPlatform();
      const needsProton = platform === 'linux';
      const protonInstalled = needsProton ? isProtonInstalled() : true;
      
      return {
        success: true,
        platform,
        needsProton,
        protonInstalled,
        ready: !needsProton || protonInstalled
      };
    } catch (error) {
      console.error('[Proton Service] Error getting platform info:', error);
      
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        platform: 'unknown',
        needsProton: false,
        protonInstalled: false,
        ready: false
      };
    }
  }
}

// Service Result Interfaces
export interface ProtonCheckResult {
  success: boolean;
  installed: boolean;
  path: string | null;
  message?: string;
  error?: string;
}

export interface ProtonInstallResult {
  success: boolean;
  message?: string;
  error?: string;
  output?: string;
}

export interface ProtonDirectoryResult {
  success: boolean;
  path: string | null;
  error?: string;
}

export interface PlatformInfoResult {
  success: boolean;
  platform: string;
  needsProton: boolean;
  protonInstalled: boolean;
  ready: boolean;
  error?: string;
}