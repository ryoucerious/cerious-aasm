import { fork, ChildProcess } from 'child_process';
import * as path from 'path';
import { messagingService } from './messaging.service';
import { settingsService } from './settings.service';
import { userDatabaseService } from './auth/user-database.service';
import * as globalConfigUtils from '../utils/global-config.utils';
import { AuthenticatedUser, LEGACY_ADMIN_ID, ROLE_IDS, SessionUser } from '../types/auth.types';
import type { ApiProcessSender, ChildToMainMessage, MainToChildMessage } from '../types/messaging.types';

const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 5_000;

export interface WebServerAuthOptions {
  enabled: boolean;
  username: string;
  password: string;
}

export interface WebServerResult {
  success: boolean;
  message: string;
  port: number;
}

export class WebServerService {
  private apiProcess: ChildProcess | null = null;
  private webServerRunning = false;
  private webServerStarting = false;
  private webServerPort = 3000;
  private commandLineLogin: WebServerAuthOptions | null = null;

  /**
   * A headless run takes the web login from the command line for the rest of the process: every
   * start uses it, and the global config's login (usually off there) is never applied over it.
   */
  useCommandLineLogin(login: WebServerAuthOptions): void {
    this.commandLineLogin = login;
  }

  usesCommandLineLogin(): boolean {
    return this.commandLineLogin !== null;
  }

  async startWebServer(port: number, authOptions?: WebServerAuthOptions): Promise<WebServerResult> {
    if (this.webServerStarting) {
      return { success: true, message: 'Web server already starting', port };
    }

    if (this.apiProcess) {
      if (this.webServerRunning && this.webServerPort === port) {
        return { success: true, message: 'Web server already running', port };
      }
      await this.stopWebServer();
    }

    this.webServerStarting = true;
    this.webServerPort = port;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Tells the child that main answers its credential checks against the user database. Set
      // for every start: the GUI starts the server without authOptions and its logins use the
      // same database.
      AASM_USER_DB: '1',
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port)
    };
    const login = this.commandLineLogin ?? authOptions;
    if (login) {
      env.AUTH_ENABLED = String(login.enabled);
      env.AUTH_USERNAME = login.username;
      env.AUTH_PASSWORD = login.password;
    }

    // __dirname is <project>/electron/services in dev, Docker and packaged builds alike.
    const child = fork(path.join(__dirname, '..', 'web-server', 'server.js'), [`--port=${port}`], { env });
    this.apiProcess = child;
    messagingService.setApiProcess(child);

    return new Promise(resolve => {
      let settled = false;
      const settle = (result: WebServerResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(startTimer);
        resolve(result);
      };

      const startTimer = setTimeout(() => {
        if (this.apiProcess === child && !this.webServerRunning) {
          this.webServerStarting = false;
          settle({ success: false, message: 'Server startup timed out', port });
        }
      }, START_TIMEOUT_MS);

      // Every handler checks the child is still the current one: after a forced stop the old
      // child can still exit or talk while its replacement is starting.
      child.on('message', (message: ChildToMainMessage) => {
        if (this.apiProcess !== child) return;
        switch (message?.type) {
          case 'server-ready':
            this.webServerRunning = true;
            this.webServerStarting = false;
            this.broadcastStatus();
            if (!this.commandLineLogin) {
              void this.sendGlobalLogin(child);
            }
            settle({ success: true, message: message.message, port: message.port });
            break;
          case 'server-error':
            this.webServerRunning = false;
            this.webServerStarting = false;
            settle({ success: false, message: message.error, port: message.port });
            break;
          case 'messaging-event':
            this.relayToBus(child, message);
            break;
          case 'auth-verify':
            void this.verifyCredentialsForChild(child, message);
            break;
        }
      });

      child.on('error', error => {
        console.error('[web-server] Web server process error:', error.message);
        if (this.apiProcess === child && !this.webServerRunning) {
          this.detach(child);
          settle({ success: false, message: `Server process error: ${error.message}`, port });
        }
      });

      child.on('exit', code => {
        this.detach(child);
        settle({ success: false, message: `Server process exited with code ${code}`, port });
      });
    });
  }

  async stopWebServer(): Promise<{ success: boolean; message: string }> {
    const child = this.apiProcess;
    if (!child) {
      return { success: true, message: 'Web server was not running' };
    }

    return new Promise(resolve => {
      const finish = (message: string) => {
        clearTimeout(forceKillTimer);
        this.detach(child);
        resolve({ success: true, message });
      };
      const forceKillTimer = setTimeout(() => {
        child.kill('SIGKILL');
        finish('Web server force stopped');
      }, STOP_TIMEOUT_MS);

      child.once('exit', () => finish('Web server stopped successfully'));
      child.kill();
    });
  }

  getStatus(): { running: boolean; port: number } {
    return {
      running: this.webServerRunning,
      port: this.webServerPort
    };
  }

  /** For app shutdown: kills the child without telling clients, which are going away too. */
  cleanup(): void {
    const child = this.apiProcess;
    if (child) {
      child.kill();
      this.forget(child);
    }
  }

  /** Forget `child` if it is still the current one; true when it was. */
  private forget(child: ChildProcess): boolean {
    if (this.apiProcess !== child) return false;
    this.apiProcess = null;
    messagingService.setApiProcess(null);
    this.webServerRunning = false;
    this.webServerStarting = false;
    return true;
  }

  /** Forget `child` and, if it was serving, tell every client it stopped. Safe to repeat. */
  private detach(child: ChildProcess): void {
    const wasRunning = this.webServerRunning;
    if (this.forget(child) && wasRunning) {
      this.broadcastStatus();
    }
  }

  private broadcastStatus(): void {
    messagingService.sendToAll('web-server-status', this.getStatus());
  }

  private relayToBus(child: ChildProcess, message: Extract<ChildToMainMessage, { type: 'messaging-event' }>): void {
    const { user, authEnabled, accountGone } = this.resolveIdentity(message.user, message.authEnabled !== false);
    const sender: ApiProcessSender = {
      type: 'api-process',
      cid: message.cid,
      user,
      authEnabled,
      send: (channel: string, data: unknown) => {
        sendToChild(child, { type: 'messaging-response', channel, data, cid: message.cid });
      }
    };
    // A handler throwing here would reach uncaughtException, which stops every ARK server.
    try {
      messagingService.emit(message.channel, message.payload, sender);
    } catch (error) {
      console.error(`[web-server] Handler for "${message.channel}" failed:`, error);
    }
    // An account deleted or disabled while the web server was down still has sessions in the
    // child, which would keep the client signed in with every request refused. Sent after the
    // reply, so the pending request is answered before the socket closes.
    if (accountGone && message.user?.id) {
      sendToChild(child, { type: 'invalidate-sessions', userId: message.user.id });
    }
  }

  /**
   * Main, not the child, decides who a web client is. The session only names the account; its
   * role and permissions are read fresh, so a demotion, deactivation or deletion applies to the
   * next message rather than at the next sign-in.
   */
  private resolveIdentity(
    claimed: SessionUser | null | undefined,
    authEnabled: boolean
  ): { user: AuthenticatedUser | null; authEnabled: boolean; accountGone: boolean } {
    if (!claimed?.id) {
      return { user: null, authEnabled, accountGone: false };
    }
    if (claimed.id === LEGACY_ADMIN_ID) {
      return { user: legacyAdmin(claimed.username), authEnabled, accountGone: false };
    }
    // Below, signed out means authentication on, so the client never falls back to the owner's rights.
    try {
      const user = userDatabaseService.getAuthenticatedUser(claimed.id);
      if (user?.active) {
        return { user, authEnabled, accountGone: false };
      }
      return { user: null, authEnabled: true, accountGone: true };
    } catch (error) {
      console.warn('[web-server] Could not look up a web client\'s account; treating it as signed out:', error);
      return { user: null, authEnabled: true, accountGone: false };
    }
  }

  private async verifyCredentialsForChild(child: ChildProcess, message: Extract<ChildToMainMessage, { type: 'auth-verify' }>): Promise<void> {
    let user: AuthenticatedUser | null = null;
    try {
      user = await userDatabaseService.verifyCredentials(message.username, message.password);
    } catch (error) {
      console.error('[web-server] Credential check failed:', error);
    }
    sendToChild(child, { type: 'auth-verify-result', requestId: message.requestId, user });
  }

  private async sendGlobalLogin(child: ChildProcess): Promise<void> {
    const config = globalConfigUtils.loadGlobalConfig();
    if (!config.authenticationEnabled && !config.authenticationUsername && !config.authenticationPassword) {
      return;
    }
    try {
      const authConfig = await settingsService.buildWebAuthConfig(config);
      sendToChild(child, { type: 'update-auth-config', authConfig });
    } catch (error) {
      console.error('[web-server] Could not hand the web login to the web server:', error);
    }
  }
}

function sendToChild(child: ChildProcess, message: MainToChildMessage): void {
  if (child.connected) {
    child.send(message);
  }
}

function legacyAdmin(username: string): AuthenticatedUser {
  return {
    id: LEGACY_ADMIN_ID,
    username,
    displayName: username,
    roleId: ROLE_IDS.ADMIN,
    roleName: 'Admin',
    permissions: [],
    active: true,
    ownerUserId: null,
    cliLocked: false,
    createdAt: 0,
    updatedAt: 0,
    lastLoginAt: null
  };
}

export const webServerService = new WebServerService();
