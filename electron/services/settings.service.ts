import * as globalConfigUtils from '../utils/global-config.utils';
import { validatePort, sanitizeString } from '../utils/validation.utils';
import * as path from 'path';
import * as fs from 'fs';
import { getDefaultInstallDir } from '../utils/platform.utils';
import * as bcrypt from 'bcrypt';

/**
 * Settings Service - Handles all business logic for application settings
 */
export class SettingsService {
  private readonly SALT_ROUNDS = 12;
  
  /**
   * Hash a password using bcrypt
   */
  private async hashPassword(password: string): Promise<string> {
    if (!password || typeof password !== 'string') {
      throw new Error('Password must be a non-empty string');
    }
    return await bcrypt.hash(password, this.SALT_ROUNDS);
  }
  
  /**
   * Get the current global configuration
   */
  getGlobalConfig(): any {
    try {
      return globalConfigUtils.loadGlobalConfig();
    } catch (error) {
      throw new Error(`Failed to load global configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update the global application configuration with validation and persistence
   * @param config - The configuration object containing updated settings
   * @returns Promise resolving to an object with success status, error message, and updated config
   */
  async updateGlobalConfig(config: any): Promise<{ success: boolean; error?: string; updatedConfig?: any }> {
    try {
      // Validate config object
      if (!config || typeof config !== 'object') {
        return { success: false, error: 'Invalid config object' };
      }

      // Validate individual config fields
      if (config.webServerPort !== undefined) {
        if (!validatePort(config.webServerPort)) {
          return { success: false, error: 'Invalid web server port' };
        }
      }

      // Sanitize string fields
      if (config.authenticationUsername !== undefined && typeof config.authenticationUsername === 'string') {
        config.authenticationUsername = sanitizeString(config.authenticationUsername);
      }

      if (config.authenticationPassword !== undefined && typeof config.authenticationPassword === 'string') {
        config.authenticationPassword = sanitizeString(config.authenticationPassword);
      }

      // Save the configuration
      const success = globalConfigUtils.saveGlobalConfig(config);
      
      if (!success) {
        return { success: false, error: 'Failed to save configuration' };
      }

      // Get the updated configuration
      const updatedConfig = globalConfigUtils.loadGlobalConfig();
      
      return { success: true, updatedConfig };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get authentication configuration for web server
   */
  getWebServerAuthConfig(config: any): { enabled: boolean; username: string; password: string } {
    return {
      enabled: config.authenticationEnabled || false,
      username: config.authenticationUsername || '',
      password: config.authenticationPassword || '' // Send plain password, let server hash it
    };
  }

  /**
   * Update the web server authentication configuration and notify the running API process
   * @param config - The configuration object containing authentication settings
   * @param apiProcess - Optional reference to the API server child process to notify of changes
   * @returns Promise that resolves when the update is complete
   */
  async updateWebServerAuth(config: any, apiProcess?: any): Promise<void> {
    const authConfig = this.getWebServerAuthConfig(config);
    
    // Save auth config to web server's config file for persistence
    try {
      const authConfigFile = path.join(getDefaultInstallDir(), 'data', 'auth-config.json');
      fs.mkdirSync(path.dirname(authConfigFile), { recursive: true });
      
      // Create the config object for the web server
      const webServerAuthConfig = {
        enabled: authConfig.enabled,
        username: authConfig.username,
        passwordHash: authConfig.password ? await this.hashPassword(authConfig.password) : ''
      };
      
      fs.writeFileSync(authConfigFile, JSON.stringify(webServerAuthConfig, null, 2), 'utf-8');
    } catch (error) {
      console.error('[Settings] Failed to save web server auth config:', error);
    }
    
    // Send auth config to web server process if it's running
    if (apiProcess && !apiProcess.killed) {
      apiProcess.send({
        type: 'update-auth-config',
        authConfig
      });
    }
  }


}

// Export singleton instance
export const settingsService = new SettingsService();