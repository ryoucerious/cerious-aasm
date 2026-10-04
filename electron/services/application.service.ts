import { webServerService, WebServerAuthOptions } from './web-server.service';
import * as globalConfigUtils from '../utils/global-config.utils';
import { parsePort } from '../utils/validation.utils';

const DEFAULT_PORT = 3000;

export interface AuthArgs {
  enabled: boolean;
  /** Empty when not given; callers default it to "admin". */
  username: string;
  password: string;
}

/** The value after the first "=", so a password may itself contain "=". */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  const arg = argv.find(a => a.startsWith(`${flag}=`));
  return arg === undefined ? undefined : arg.slice(flag.length + 1);
}

/**
 * The web login given at startup. A flag wins over its environment variable
 * (AASM_AUTH_ENABLED=true, AASM_USERNAME, AASM_PASSWORD), which lets Docker keep the password
 * out of argv, where every process on the host can read it.
 */
export function readAuthArgs(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): AuthArgs {
  return {
    enabled: argv.includes('--auth-enabled') || env.AASM_AUTH_ENABLED === 'true',
    username: flagValue(argv, '--username') ?? env.AASM_USERNAME ?? '',
    password: flagValue(argv, '--password') ?? env.AASM_PASSWORD ?? ''
  };
}

/** The --port value, or undefined when it is absent or not a port (1-65535). */
export function readPortArg(argv: readonly string[] = process.argv): number | undefined {
  const value = flagValue(argv, '--port');
  if (value === undefined) return undefined;
  const port = parsePort(value);
  if (port === undefined) {
    console.warn(`[application] Ignoring --port=${value}: not a port number`);
  }
  return port;
}

function printHelp(): void {
  console.log('\nCerious ARK Server Manager - Headless Mode Options:\n');
  console.log('  --headless                    Run in headless mode (no GUI)');
  console.log('  --port=<port>                 Set web server port (default: 3000)');
  console.log('  --auth-enabled                Enable authentication for web interface');
  console.log('  --username=<username>         Set authentication username (default: admin)');
  console.log('  --password=<password>         Admin password (reapplied every start, not changeable in the app)');
  console.log('\nWithout the flags, AASM_AUTH_ENABLED=true, AASM_USERNAME and AASM_PASSWORD are read instead.');
  console.log('\nExamples:');
  console.log('  electron main.js --headless --port=8080');
  console.log('  electron main.js --headless --auth-enabled --username=user --password=change-me');
  console.log('  electron main.js --headless --port=3000 --auth-enabled --password=mypassword\n');
}

export class ApplicationService {
  private readonly headless = process.argv.includes('--headless');

  constructor() {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      printHelp();
      process.exit(0);
    }
  }

  /** Starts the web server: always when headless, otherwise only if the global config asks for it. */
  async initializeApplication(): Promise<void> {
    const config = globalConfigUtils.loadGlobalConfig();
    const port = readPortArg() ?? (config.webServerPort || DEFAULT_PORT);

    if (!this.headless) {
      if (config.startWebServerOnLoad) {
        await webServerService.startWebServer(port);
      }
      return;
    }

    const auth = readAuthArgs();
    let authOptions: WebServerAuthOptions = { enabled: false, username: '', password: '' };
    if (auth.enabled) {
      // A password is optional: without one, the accounts under Users & Roles are the only way in.
      if (!auth.password) {
        console.log('[application] Authentication is on with no password: sign-in is by account.');
      }
      authOptions = { enabled: true, username: auth.username || 'admin', password: auth.password };
    }
    webServerService.useCommandLineLogin(authOptions);
    await webServerService.startWebServer(port, authOptions);
  }

  isHeadless(): boolean {
    return this.headless;
  }
}

export const applicationService = new ApplicationService();
