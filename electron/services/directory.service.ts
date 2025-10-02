import { shell } from 'electron';
import { getDefaultInstallDir } from '../utils/platform.utils';
import { getInstance } from '../utils/ark/instance.utils';
import { validateInstanceId } from '../utils/validation.utils';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Directory Service - Handles all business logic for directory operations
 */
export class DirectoryService {

  /**
   * Open the main configuration directory in the system file explorer
   * @returns Promise resolving to an object indicating success or failure of opening the config directory
   */
  async openConfigDirectory(): Promise<{ success: boolean; configDir: string; error?: string }> {
    try {
      const configDir = getDefaultInstallDir();
      await shell.openPath(configDir);
      return { success: true, configDir };
    } catch (error) {
      return { 
        success: false, 
        configDir: '', 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Open a server instance directory with security validation
   * @param instanceId - The unique identifier of the server instance
   * @returns Promise resolving to an object indicating success or failure of opening the instance directory
   */
  async openInstanceDirectory(instanceId: string): Promise<{ success: boolean; instanceId?: string; error?: string }> {
    try {
      // Validate the instance ID
      if (!validateInstanceId(instanceId)) {
        return { success: false, error: 'Invalid instance ID' };
      }

      // Verify instance exists in our database
      const instance = await getInstance(instanceId);
      if (!instance) {
        return { success: false, error: 'Instance not found' };
      }

      // Get the server directory path
      const serverDir = this.getInstanceDirectoryPath(instanceId);
      
      // Perform security validation
      const securityCheck = this.validateDirectoryPath(serverDir);
      if (!securityCheck.isValid) {
        return { success: false, error: securityCheck.error };
      }

      // Open the directory
      await shell.openPath(serverDir);
      
      return { success: true, instanceId };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Get the base directory for server instances
   * @returns The base directory where all server instances are stored
   */
  getServerInstancesBaseDirectory(): string {
    return path.join(getDefaultInstallDir(), 'AASMServer', 'ShooterGame', 'Saved', 'Servers');
  }

  /**
   * Get the default configuration directory path
   * @returns The default configuration directory path
   */
  getConfigDirectory(): string {
    return getDefaultInstallDir();
  }

  /**
   * Get the directory path for a server instance
   * @param instanceId - The unique identifier of the server instance
   * @returns The directory path for the server instance
   */
  private getInstanceDirectoryPath(instanceId: string): string {
    const baseDir = path.join(getDefaultInstallDir(), 'AASMServer', 'ShooterGame', 'Saved', 'Servers');
    return path.join(baseDir, instanceId);
  }

  /**
   * Test if a directory is accessible for cluster operations
   * @param directoryPath - The directory path to test (can be absolute or relative to ARK install dir)
   * @returns Promise resolving to an object indicating if the directory is accessible
   */
  async testDirectoryAccess(directoryPath: string): Promise<{ accessible: boolean; error?: string }> {
    try {
      // Resolve relative paths relative to the ARK installation directory
      let resolvedPath = directoryPath;
      if (!path.isAbsolute(directoryPath)) {
        resolvedPath = path.resolve(getDefaultInstallDir(), directoryPath);
      }

      // Check if the path exists
      const stats = await fs.promises.stat(resolvedPath);

      // Check if it's actually a directory
      if (!stats.isDirectory()) {
        return { accessible: false, error: 'Path is not a directory' };
      }

      // Try to read the directory contents to verify access
      await fs.promises.readdir(resolvedPath);

      // Try to write a test file to verify write access
      const testFile = path.join(resolvedPath, '.cluster-test.tmp');
      await fs.promises.writeFile(testFile, 'test', 'utf8');
      await fs.promises.unlink(testFile);

      return { accessible: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { accessible: false, error: errorMsg };
    }
  }

  /**
   * Validate directory path to prevent path traversal attacks
   * @param targetPath - The target directory path to validate
   * @returns An object indicating whether the path is valid and an error message if not
   */
  private validateDirectoryPath(targetPath: string): { isValid: boolean; error?: string } {
    try {
      const baseDir = path.join(getDefaultInstallDir(), 'AASMServer', 'ShooterGame', 'Saved', 'Servers');
      const resolvedPath = path.resolve(targetPath);
      const basePath = path.resolve(baseDir);

      if (!resolvedPath.startsWith(basePath)) {
        console.error('[DirectoryService] Path traversal attempt detected:', resolvedPath);
        return { isValid: false, error: 'Access denied' };
      }

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

// Export singleton instance
export const directoryService = new DirectoryService();