import { shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getDefaultInstallDir } from '../utils/platform.utils';
import { getInstance, getInstanceDir } from '../utils/ark/instance.utils';
import { validateInstanceId } from '../utils/validation.utils';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Opens app folders in the system file manager, and checks cluster directories. */
export class DirectoryService {
  async openConfigDirectory(): Promise<{ success: boolean; configDir: string; error?: string }> {
    try {
      const configDir = getDefaultInstallDir();
      // Resolves with an error message rather than rejecting.
      const failure = await shell.openPath(configDir);
      return failure ? { success: false, configDir: '', error: failure } : { success: true, configDir };
    } catch (error) {
      return { success: false, configDir: '', error: describeError(error) };
    }
  }

  async openInstanceDirectory(instanceId: string): Promise<{ success: boolean; instanceId?: string; error?: string }> {
    try {
      if (!validateInstanceId(instanceId)) {
        return { success: false, error: 'Invalid instance ID' };
      }
      if (!getInstance(instanceId)) {
        return { success: false, error: 'Instance not found' };
      }
      const failure = await shell.openPath(getInstanceDir(instanceId));
      return failure ? { success: false, error: failure } : { success: true, instanceId };
    } catch (error) {
      return { success: false, error: describeError(error) };
    }
  }

  /**
   * Whether a cluster directory exists and can be written. A relative path resolves against the
   * install dir, as the -ClusterDirOverride launch argument does. Writes and deletes a probe file.
   */
  async testDirectoryAccess(directoryPath: unknown): Promise<{ accessible: boolean; error?: string }> {
    if (typeof directoryPath !== 'string' || !directoryPath.trim()) {
      return { accessible: false, error: 'No directory given' };
    }
    try {
      const resolvedPath = path.isAbsolute(directoryPath) ? directoryPath : path.resolve(getDefaultInstallDir(), directoryPath);

      const stats = await fs.promises.stat(resolvedPath);
      if (!stats.isDirectory()) {
        return { accessible: false, error: 'Path is not a directory' };
      }

      await fs.promises.readdir(resolvedPath);
      const testFile = path.join(resolvedPath, '.cluster-test.tmp');
      await fs.promises.writeFile(testFile, 'test', 'utf8');
      await fs.promises.unlink(testFile);

      return { accessible: true };
    } catch (error) {
      return { accessible: false, error: describeError(error) };
    }
  }
}

export const directoryService = new DirectoryService();