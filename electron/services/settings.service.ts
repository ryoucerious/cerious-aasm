import * as path from 'path';
import * as fs from 'fs';
import * as bcrypt from 'bcrypt';
import type { ChildProcess } from 'child_process';
import * as globalConfigUtils from '../utils/global-config.utils';
import type { GlobalConfig } from '../utils/global-config.utils';
import { validatePort, sanitizeString } from '../utils/validation.utils';
import { getDefaultInstallDir } from '../utils/platform.utils';
import { readJsonOrQuarantine, writeJsonAtomic } from '../utils/fs.utils';
import type { MainToChildMessage, WebAuthConfigUpdate } from '../types/messaging.types';
import type { WebServerAuthOptions } from './web-server.service';

const SALT_ROUNDS = 12;

/** The global config as clients see it: the web password is never sent, only whether one is set. */
export type PublicGlobalConfig = Omit<GlobalConfig, 'authenticationPassword'> & { authenticationPasswordSet: boolean };

export function toPublicGlobalConfig(config: GlobalConfig): PublicGlobalConfig {
  const { authenticationPassword, ...rest } = config;
  return { ...rest, authenticationPasswordSet: !!authenticationPassword };
}

export class SettingsService {
  getGlobalConfig(): GlobalConfig {
    try {
      return globalConfigUtils.loadGlobalConfig();
    } catch (error) {
      throw new Error(`Failed to load global configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validates and saves a config from a client, then returns the stored result. Without
   * canChangeLogin the stored web login (enabled, username, password) is kept whatever the client sent.
   */
  async updateGlobalConfig(
    config: unknown,
    { canChangeLogin }: { canChangeLogin: boolean }
  ): Promise<{ success: boolean; error?: string; updatedConfig?: GlobalConfig }> {
    try {
      if (!config || typeof config !== 'object') {
        return { success: false, error: 'Invalid config object' };
      }
      const incoming: Partial<GlobalConfig> & { authenticationPasswordSet?: unknown } = { ...config };
      delete incoming.authenticationPasswordSet;

      if (!canChangeLogin) {
        const { authenticationEnabled, authenticationUsername, authenticationPassword } = globalConfigUtils.loadGlobalConfig();
        Object.assign(incoming, { authenticationEnabled, authenticationUsername, authenticationPassword });
      }

      if (incoming.webServerPort !== undefined && !validatePort(incoming.webServerPort)) {
        return { success: false, error: 'Invalid web server port' };
      }

      if (incoming.serverDataDir && typeof incoming.serverDataDir === 'string') {
        const resolvedPath = path.resolve(incoming.serverDataDir);
        try {
          if (!fs.existsSync(resolvedPath)) {
            fs.mkdirSync(resolvedPath, { recursive: true });
          }
          fs.accessSync(resolvedPath, fs.constants.W_OK);
          incoming.serverDataDir = resolvedPath;
        } catch (e) {
          return { success: false, error: `Invalid Server Data Directory: ${e instanceof Error ? e.message : 'Path not writable'}` };
        }
      }

      if (typeof incoming.authenticationUsername === 'string') {
        incoming.authenticationUsername = sanitizeString(incoming.authenticationUsername);
      }

      // Clients never receive the stored password (see toPublicGlobalConfig), so an absent or
      // empty one means "unchanged". A new one is kept exactly as typed.
      if (typeof incoming.authenticationPassword !== 'string' || incoming.authenticationPassword === '') {
        incoming.authenticationPassword = globalConfigUtils.loadGlobalConfig().authenticationPassword;
      }

      if (!globalConfigUtils.saveGlobalConfig(incoming as GlobalConfig)) {
        return { success: false, error: 'Failed to save configuration' };
      }

      return { success: true, updatedConfig: globalConfigUtils.loadGlobalConfig() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** The plain login, for the web server child's environment when main forks it. */
  getWebServerAuthConfig(config: Partial<GlobalConfig>): WebServerAuthOptions {
    return {
      enabled: config.authenticationEnabled || false,
      username: config.authenticationUsername || '',
      password: config.authenticationPassword || ''
    };
  }

  /** The login as the web server stores it. Hashed here so plaintext never crosses the IPC channel. */
  async buildWebAuthConfig(config: GlobalConfig): Promise<WebAuthConfigUpdate> {
    const { enabled, username, password } = this.getWebServerAuthConfig(config);
    return {
      enabled,
      username,
      passwordHash: password ? await this.hashUnlessUnchanged(password) : ''
    };
  }

  // bcrypt salts every hash, so re-hashing an unchanged password would look like a new login to
  // the web server, which then makes every client reconnect. Keep the saved hash while it matches.
  private async hashUnlessUnchanged(password: string): Promise<string> {
    let savedHash: unknown;
    try {
      savedHash = readJsonOrQuarantine<{ passwordHash?: unknown }>(authConfigPath())?.passwordHash;
    } catch {
      savedHash = undefined;
    }
    if (typeof savedHash === 'string' && savedHash && await bcrypt.compare(password, savedHash).catch(() => false)) {
      return savedHash;
    }
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Saves the web login to auth-config.json and hands it to a running web server, which also
   * writes that file. Both write the same hash, atomically and readable only by the owner.
   */
  async updateWebServerAuth(config: GlobalConfig, child: ChildProcess | null): Promise<void> {
    const authConfig = await this.buildWebAuthConfig(config);

    try {
      const authConfigFile = authConfigPath();
      fs.mkdirSync(path.dirname(authConfigFile), { recursive: true });
      writeJsonAtomic(authConfigFile, authConfig, { mode: 0o600 });
    } catch (error) {
      console.error('[settings] Failed to save web server auth config:', error);
    }

    if (child?.connected) {
      const message: MainToChildMessage = { type: 'update-auth-config', authConfig };
      child.send(message);
    }
  }
}

function authConfigPath(): string {
  return path.join(getDefaultInstallDir(), 'data', 'auth-config.json');
}

export const settingsService = new SettingsService();
