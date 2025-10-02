import { fork } from 'child_process';
import * as path from 'path';
import { app } from 'electron';
import { isPortInUse } from '../utils/network.utils';
import { messagingService } from './messaging.service';
import * as globalConfigUtils from '../utils/global-config.utils';

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
  private apiProcess: import('child_process').ChildProcess | null = null;
  private webServerRunning = false;
  private webServerStarting = false;
  private webServerPort = 3000;
  private statusPollingInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startStatusPolling();
  }

  /**
   * Get the correct path for the API server in both dev and production
   */
  private getApiServerPath(): string {
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      return path.join(__dirname, '..', 'web-server', 'server.js');
    } else {
      // In production, use app.getAppPath() for reliable path resolution
      return path.join(app.getAppPath(), 'electron', 'web-server', 'server.js');
    }
  }

  /**
   * Start polling for web server status
   */
  private startStatusPolling(): void {
    let lastWebServerStatus = false;

    this.statusPollingInterval = setInterval(async () => {
      const portInUse = await isPortInUse(this.webServerPort);
      if (portInUse !== lastWebServerStatus) {
        lastWebServerStatus = portInUse;
        // Unify channel: always broadcast on 'web-server-status'
        messagingService.broadcastToWebClients('web-server-status', {
          running: portInUse,
          port: this.webServerPort
        });
      }
    }, 2000);
  }

  /**
   * Start the web server
   */
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

    // Prepare environment variables for authentication
    const env = { ...process.env };
    if (authOptions) {
      env.AUTH_ENABLED = authOptions.enabled.toString();
      env.AUTH_USERNAME = authOptions.username;
      env.AUTH_PASSWORD = authOptions.password;
    }

    // Fork API process, which will listen and attach WebSocket server
    const apiServerPath = this.getApiServerPath();

    this.apiProcess = fork(apiServerPath, [`--port=${port}`], {
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(port),
      },
    });

    // Set apiProcess on messagingService for web client broadcasts
    messagingService.setApiProcess(this.apiProcess);

    return new Promise((resolve) => {
      // Handle server ready/error messages
      const handleServerMessage = (message: any) => {
        if (message.type === 'server-ready') {
          this.webServerRunning = true;
          this.webServerStarting = false;

          // Send current authentication configuration to the web server
          // Skip this in headless mode as authentication is initialized from environment variables
          const isHeadless = process.argv.includes('--headless');
          if (!isHeadless) {
            const config = globalConfigUtils.loadGlobalConfig();
            if (config.authenticationEnabled || config.authenticationUsername || config.authenticationPassword) {
              const authConfig = {
                enabled: config.authenticationEnabled || false,
                username: config.authenticationUsername || '',
                password: config.authenticationPassword || '' // Send plain password, let server hash it
              };

              this.apiProcess?.send({
                type: 'update-auth-config',
                authConfig
              });
            }
          }

          resolve({ success: true, message: message.message, port: message.port });
        } else if (message.type === 'server-error') {
          this.webServerRunning = false;
          this.webServerStarting = false;
          resolve({ success: false, message: message.error, port: message.port });
        } else if (message.type === 'messaging-event') {
          // Forward to main process handlers, then respond to API process with cid
          messagingService.emit(message.channel, message.payload, {
            type: 'api-process',
            cid: message.cid, // Pass cid for exclusion logic
            send: (channel: string, data: any) => {
              this.apiProcess?.send({ type: 'messaging-response', channel, data, cid: message.cid });
            }
          });
        }
      };

      if (this.apiProcess) {
        this.apiProcess.on('message', handleServerMessage);

        this.apiProcess.on('error', (error) => {
          this.webServerRunning = false;
          this.webServerStarting = false;
          resolve({ success: false, message: `Server process error: ${error.message}`, port });
        });

        this.apiProcess.on('exit', (code) => {
          this.webServerRunning = false;
          this.webServerStarting = false;
          this.apiProcess = null;
          if (code !== 0) {
            resolve({ success: false, message: `Server process exited with code ${code}`, port });
          }
        });
      }      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.apiProcess && !this.webServerRunning) {
          this.webServerStarting = false;
          resolve({ success: false, message: 'Server startup timed out', port });
        }
      }, 10000);
    });
  }

  /**
   * Stop the web server
   */
  async stopWebServer(): Promise<{ success: boolean; message: string }> {
    if (!this.apiProcess) {
      return { success: true, message: 'Web server was not running' };
    }

    return new Promise((resolve) => {
      const cleanupAndResolve = (message: string) => {
        this.apiProcess = null;
        this.webServerRunning = false;
        this.webServerStarting = false;
        resolve({ success: true, message });
      };

      if (this.apiProcess) {
        this.apiProcess.on('exit', () => {
          cleanupAndResolve('Web server stopped successfully');
        });

        this.apiProcess.kill();
      }      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.apiProcess) {
          this.apiProcess.kill('SIGKILL');
          cleanupAndResolve('Web server force stopped');
        }
      }, 5000);
    });
  }

  /**
   * Get current web server status
   */
  getStatus(): { running: boolean; port: number } {
    return {
      running: this.webServerRunning,
      port: this.webServerPort
    };
  }

  /**
   * Check if web server is currently starting
   */
  isStarting(): boolean {
    return this.webServerStarting;
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.statusPollingInterval) {
      clearInterval(this.statusPollingInterval);
      this.statusPollingInterval = null;
    }

    if (this.apiProcess) {
      this.apiProcess.kill();
      this.apiProcess = null;
    }

    this.webServerRunning = false;
    this.webServerStarting = false;
  }
}

// Export singleton instance
export const webServerService = new WebServerService();