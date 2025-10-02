import { webServerService, WebServerAuthOptions } from './web-server.service';
import * as globalConfigUtils from '../utils/global-config.utils';

export interface CommandLineArgs {
  isHeadless: boolean;
  authEnabled: boolean;
  username: string;
  password: string;
  port: number;
}

export class ApplicationService {
  private commandLineArgs: CommandLineArgs;

  constructor() {
    this.commandLineArgs = this.parseCommandLineArgs();
  }

  /**
   * Parse command line arguments
   */
  private parseCommandLineArgs(): CommandLineArgs {
    // Check for help flag first
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      console.log('\nCerious ARK Server Manager - Headless Mode Options:\n');
      console.log('  --headless                    Run in headless mode (no GUI)');
      console.log('  --port=<port>                Set web server port (default: 3000)');
      console.log('  --auth-enabled                Enable authentication for web interface');
      console.log('  --username=<username>         Set authentication username (default: admin)');
      console.log('  --password=<password>         Set authentication password (required with --auth-enabled)');
      console.log('\nExamples:');
      console.log('  electron main.js --headless --port=8080');
      console.log('  electron main.js --headless --auth-enabled --username=user --password=secret');
      console.log('  electron main.js --headless --port=3000 --auth-enabled --password=mypassword\n');
      process.exit(0);
    }

    const isHeadless = process.argv.includes('--headless');
    const authEnabled = process.argv.includes('--auth-enabled');
    const usernameArg = process.argv.find(a => a.startsWith('--username='));
    const passwordArg = process.argv.find(a => a.startsWith('--password='));
    const portArg = process.argv.find(a => a.startsWith('--port='));

    // Extract values from arguments
    const username = usernameArg ? usernameArg.split('=')[1] : 'admin';
    const password = passwordArg ? passwordArg.split('=')[1] : '';

    const config = globalConfigUtils.loadGlobalConfig();
    const port = portArg ? parseInt(portArg.split('=')[1], 10) : (config.webServerPort || 3000);

    return {
      isHeadless,
      authEnabled,
      username,
      password,
      port
    };
  }

  /**
   * Get parsed command line arguments
   */
  getCommandLineArgs(): CommandLineArgs {
    return this.commandLineArgs;
  }

  /**
   * Initialize the application based on command line arguments
   */
  async initializeApplication(): Promise<void> {
    const { isHeadless, authEnabled, username, password, port } = this.commandLineArgs;

    if (isHeadless) {
      // In headless mode, determine authentication settings
      let authOptions: WebServerAuthOptions | undefined;

      if (authEnabled) {
        if (!password) {
          console.error('[ApplicationService] Error: --auth-enabled requires --password to be set');
          process.exit(1);
        }
        authOptions = {
          enabled: true,
          username,
          password
        };
      } else {
        authOptions = {
          enabled: false,
          username: '',
          password: ''
        };
      }

      await webServerService.startWebServer(port, authOptions);
    } else {
      // In GUI mode, start web server if configured
      const config = globalConfigUtils.loadGlobalConfig();
      if (config.startWebServerOnLoad) {
        await webServerService.startWebServer(port);
      }
    }
  }

  /**
   * Check if application is running in headless mode
   */
  isHeadless(): boolean {
    return this.commandLineArgs.isHeadless;
  }
}

// Export singleton instance
export const applicationService = new ApplicationService();