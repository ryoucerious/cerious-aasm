import { app } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { InstallCancelledError } from './installer.utils';
import { getPlatform } from './platform.utils';

type PackageManagerName = 'apt' | 'dnf' | 'yum' | 'pacman' | 'zypper';

export interface LinuxDependency {
  name: string;
  /** One name for every distribution, or a name per package manager. */
  packageName: string | Partial<Record<PackageManagerName, string>>;
  /** For apt: try these package names in order if the primary packageName fails to install */
  aptAlternatives?: string[];
  checkCommand: string;
  description: string;
  required: boolean;
}

export interface DependencyCheckResult {
  dependency: LinuxDependency;
  installed: boolean;
  version?: string;
}

export interface LinuxDepsInstallProgress {
  step: string;
  message: string;
  percent: number;
  dependency?: string;
}

export interface LinuxDepsInstallOutcome {
  success: boolean;
  message: string;
  details: string[];
}

interface PackageManager {
  manager: PackageManagerName;
  /** Installs the package name appended to it. */
  install: string[];
  update: string[];
}

// Required dependencies for ARK server on Linux
export const LINUX_DEPENDENCIES: LinuxDependency[] = [
  {
    name: 'cURL',
    packageName: 'curl',
    checkCommand: 'curl --version',
    description: 'Required for downloading Proton and SteamCMD',
    required: true
  },
  {
    name: 'Unzip',
    packageName: 'unzip',
    checkCommand: 'unzip -v',
    description: 'Required for extracting downloaded archives',
    required: true
  },
  {
    name: 'Tar',
    packageName: 'tar',
    checkCommand: 'tar --version',
    description: 'Required for extracting Proton archive',
    required: true
  },
  {
    name: 'Xvfb',
    packageName: {
      'apt': 'xvfb',
      'dnf': 'xorg-x11-server-Xvfb',
      'yum': 'xorg-x11-server-Xvfb',
      'pacman': 'xorg-server-xvfb',
      'zypper': 'xvfb'
    },
    checkCommand: 'xvfb-run --help',
    description: 'Virtual framebuffer for running ARK server headless',
    required: true
  },
  {
    name: 'SteamCMD Dependencies (32-bit libraries)',
    packageName: {
      'apt': 'libc6:i386',
      'dnf': 'glibc.i686',
      'yum': 'glibc.i686',
      'pacman': 'lib32-glibc',
      'zypper': 'glibc-32bit'
    },
    checkCommand: 'ldconfig -p | grep -E "libc\\.so\\.6.*i[36]86|libc\\.so\\.6.*x32"',
    description: '32-bit C library support required for SteamCMD (downloads ARK server files)',
    required: true
  },
  {
    name: 'ALSA Audio Library',
    packageName: {
      'apt': 'libasound2',
      'dnf': 'alsa-lib',
      'yum': 'alsa-lib',
      'pacman': 'alsa-lib',
      'zypper': 'alsa'
    },
    // Ubuntu 23.04+ renamed libasound2 to libasound2t64 (64-bit time_t transition), so t64 is
    // tried first. A transitional libasound2 stub on 24.04 shows as installed without providing
    // snd_device_name_get_hint, which crashes Electron at startup. The check therefore:
    //   - passes when libasound2t64 is installed;
    //   - fails when it is in the apt cache but not installed (the stub must not count);
    //   - otherwise passes when libasound2 ships libasound.so.2 (Debian Bookworm, Ubuntu 22.04).
    //     dpkg -L rejects the 24.04 stub even when the apt lists are gone;
    //   - off apt, looks for the .so with ldconfig.
    aptAlternatives: ['libasound2t64', 'libasound2'],
    checkCommand: [
      'if command -v dpkg >/dev/null 2>&1; then',
      '  if dpkg -l libasound2t64 2>/dev/null | grep -q \'^ii\'; then exit 0; fi',
      '  if apt-cache show libasound2t64 >/dev/null 2>&1; then exit 1; fi',
      '  dpkg -L libasound2 2>/dev/null | grep -q \'libasound\\.so\\.2\'',
      'else',
      '  ldconfig -p | grep -q \'libasound\\.so\\.2\'',
      'fi'
    ].join('\n'),
    description: 'ALSA audio library required by Electron (audio output is disabled at runtime)',
    required: true
  },
  {
    name: 'Font Configuration',
    packageName: 'fontconfig',
    checkCommand: 'fc-list',
    description: 'Font configuration for better Proton compatibility',
    required: false
  }
];

const CHECK_TIMEOUT_MS = 5000;
// Long enough for a big apt download on a slow mirror. A command stopped at this point may be apt
// or dpkg part way through, which can leave the package database needing repair.
const SUDO_TIMEOUT_MS = 15 * 60 * 1000;
const INSTALL_LOG_NAME = 'linux-deps-install.log';

// Package names only come from LINUX_DEPENDENCIES; they are checked anyway because they reach a
// root package manager. A leading dash would be read as an option.
const PACKAGE_NAME = /^[a-z0-9.+:_-]+$/i;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function checkDependency(dependency: LinuxDependency): Promise<DependencyCheckResult> {
  if (getPlatform() !== 'linux') {
    return Promise.resolve({ dependency, installed: true, version: 'N/A (not Linux)' });
  }

  return new Promise(resolve => {
    let stdout = '';
    let settled = false;
    const finish = (result: DependencyCheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn('bash', ['-c', dependency.checkCommand], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill();
      finish({ dependency, installed: false });
    }, CHECK_TIMEOUT_MS);

    child.stdout?.on('data', data => { stdout += data.toString(); });
    child.on('error', error => {
      console.warn(`[system-deps] Could not check ${dependency.name}:`, error.message);
      finish({ dependency, installed: false });
    });
    child.on('close', code => {
      if (code !== 0) {
        finish({ dependency, installed: false, version: undefined });
        return;
      }
      const version = stdout ? /\d+\.\d+[.\d]*/.exec(stdout.split('\n')[0])?.[0] ?? 'installed' : '';
      finish({ dependency, installed: true, version });
    });
  });
}

export async function checkAllDependencies(): Promise<DependencyCheckResult[]> {
  const results: DependencyCheckResult[] = [];
  for (const dependency of LINUX_DEPENDENCIES) {
    results.push(await checkDependency(dependency));
  }
  return results;
}

/** The known dependencies with these names, or undefined when any entry is not a known name. */
export function findDependencies(names: readonly unknown[]): LinuxDependency[] | undefined {
  const found: LinuxDependency[] = [];
  for (const name of names) {
    const dependency = typeof name === 'string' ? LINUX_DEPENDENCIES.find(dep => dep.name === name) : undefined;
    if (!dependency) return undefined;
    found.push(dependency);
  }
  return found;
}

function packageNameFor(dependency: LinuxDependency, manager: PackageManagerName | undefined): string {
  if (typeof dependency.packageName === 'string') {
    return dependency.packageName;
  }
  const names = dependency.packageName;
  return (manager && names[manager]) || names.apt || Object.values(names)[0] || '';
}

export function getPackageNameForDistribution(dependency: LinuxDependency): string {
  return packageNameFor(dependency, getPackageManagerInfo()?.manager);
}

export function generateInstallInstructions(missingDeps: LinuxDependency[]): string {
  const packageManager = getPackageManagerInfo();
  if (!packageManager) {
    return 'Could not detect package manager. Please install the missing dependencies manually.';
  }

  const packageList = missingDeps.map(dep => packageNameFor(dep, packageManager.manager)).join(' ');
  const intro = 'To install the missing dependencies, run the following command:\n\n';
  switch (packageManager.manager) {
    case 'dnf':
      return `${intro}sudo dnf install ${packageList}\n\n` +
        'For Fedora users, you may also need to enable RPM Fusion repositories:\n' +
        'sudo dnf install https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm';
    case 'yum':
      return `${intro}sudo yum install ${packageList}`;
    case 'apt':
      return `${intro}sudo apt-get update && sudo apt-get install ${packageList}`;
    case 'pacman':
      return `${intro}sudo pacman -S ${packageList}`;
    case 'zypper':
      return `${intro}sudo zypper install ${packageList}`;
  }
}

export function getPackageManagerInfo(): PackageManager | null {
  if (getPlatform() !== 'linux') {
    return null;
  }
  if (fs.existsSync('/usr/bin/apt') || fs.existsSync('/usr/bin/apt-get')) {
    return { manager: 'apt', install: ['apt-get', 'install', '-y'], update: ['apt-get', 'update'] };
  }
  // makecache refreshes the metadata without upgrading the whole system.
  if (fs.existsSync('/usr/bin/dnf')) {
    return { manager: 'dnf', install: ['dnf', 'install', '-y'], update: ['dnf', 'makecache'] };
  }
  if (fs.existsSync('/usr/bin/yum')) {
    return { manager: 'yum', install: ['yum', 'install', '-y'], update: ['yum', 'makecache'] };
  }
  if (fs.existsSync('/usr/bin/pacman')) {
    return { manager: 'pacman', install: ['pacman', '-S', '--noconfirm'], update: ['pacman', '-Sy'] };
  }
  if (fs.existsSync('/usr/bin/zypper')) {
    return { manager: 'zypper', install: ['zypper', 'install', '-y'], update: ['zypper', 'refresh'] };
  }
  return null;
}

function installLogPath(): string {
  return path.join(app.getPath('logs'), INSTALL_LOG_NAME);
}

/** Keeps the output of a failed command for the user; the summary shown in the UI is short. */
function logFailure(argv: string[], code: number | null, stdout: string, stderr: string): void {
  try {
    fs.mkdirSync(app.getPath('logs'), { recursive: true });
    const entry = `\n==== ${new Date().toISOString()} ${argv.join(' ')} (exit ${code}) ====\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}\n`;
    fs.appendFileSync(installLogPath(), entry);
  } catch (error) {
    console.warn('[system-deps] Could not write the install log:', describeError(error));
  }
}

/**
 * Runs `argv` as root, with no shell. -k makes sudo ignore cached credentials, so it always reads
 * the password line from stdin instead of passing it on to the command; -p '' keeps the prompt
 * out of the output. stdin is closed after the password, so a wrong one fails at once instead of
 * re-prompting until the timeout. DEBIAN_FRONTEND goes through env(1) because sudo's env_reset
 * drops variables set on sudo itself.
 */
function runAsRoot(argv: string[], password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout);
    };

    const child = spawn('sudo', ['-S', '-k', '-p', '', '--', 'env', 'DEBIAN_FRONTEND=noninteractive', ...argv], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const timer = setTimeout(() => {
      const repairHint = argv[0] === 'apt-get' || argv[0] === 'dpkg'
        ? 'If apt or dpkg now reports errors, run "sudo dpkg --configure -a".'
        : 'The package manager may need to finish or repair the interrupted run before the next install.';
      console.error(`[system-deps] ${argv.join(' ')} still running after ${SUDO_TIMEOUT_MS / 60000} minutes; stopping it. ${repairHint}`);
      child.kill();
      settle(new Error(`${argv.join(' ')} timed out`));
    }, SUDO_TIMEOUT_MS);

    child.stdout?.on('data', data => { stdout += data.toString(); });
    child.stderr?.on('data', data => { stderr += data.toString(); });
    child.on('error', settle);
    child.on('close', code => {
      if (code === 0) {
        settle(null);
        return;
      }
      logFailure(argv, code, stdout, stderr);
      settle(new Error(`${argv.join(' ')} failed with code ${code}: ${(stderr || stdout).trim()}`));
    });

    // sudo exiting before it reads stdin surfaces as EPIPE here; the exit code reports the failure.
    child.stdin?.on('error', () => {});
    // Root is never asked, and the line would reach the command instead.
    if (process.getuid?.() !== 0) {
      child.stdin?.write(`${password}\n`);
    }
    child.stdin?.end();
  });
}

function installPackage(packageManager: PackageManager, packageName: string, password: string, extraArgs: string[] = []): Promise<string> {
  if (!PACKAGE_NAME.test(packageName) || packageName.startsWith('-')) {
    return Promise.reject(new Error(`Refusing to install "${packageName}": not a valid package name`));
  }
  return runAsRoot([...packageManager.install, ...extraArgs, packageName], password);
}

/**
 * Installs the named dependencies (names from LINUX_DEPENDENCIES) with the user's sudo password.
 * An aborted `signal` stops it before the next command: a running apt or dpkg is never killed,
 * because that can leave the package database broken.
 */
export async function installMissingDependencies(
  dependencyNames: readonly string[],
  sudoPassword: string,
  onProgress: (progress: LinuxDepsInstallProgress) => void,
  signal?: AbortSignal
): Promise<LinuxDepsInstallOutcome> {
  if (getPlatform() !== 'linux') {
    return { success: true, message: 'Not running on Linux, dependencies not required', details: [] };
  }

  const missingDeps = findDependencies(dependencyNames);
  if (!missingDeps) {
    return { success: false, message: 'Unknown dependency requested', details: [] };
  }
  if (missingDeps.length === 0) {
    return { success: true, message: 'All dependencies already installed', details: [] };
  }

  const packageManager = getPackageManagerInfo();
  if (!packageManager) {
    return { success: false, message: 'Could not detect package manager. Supported: apt, yum, dnf, pacman, zypper', details: [] };
  }

  const results: string[] = [];
  // One step for the apt fix-ups (skipped elsewhere), one for the package list, one per package.
  const totalSteps = missingDeps.length + 2;
  let currentStep = 0;
  const percent = () => Math.round((currentStep / totalSteps) * 100);
  const stopIfCancelled = () => {
    if (signal?.aborted) throw new InstallCancelledError();
  };

  try {
    stopIfCancelled();
    if (packageManager.manager === 'apt') {
      onProgress({ step: 'dpkg-fix', message: 'Fixing any interrupted package configurations...', percent: percent() });
      try {
        await runAsRoot(['dpkg', '--configure', '-a'], sudoPassword);
        results.push('Fixed interrupted dpkg configurations');
      } catch (error) {
        results.push(`Warning: dpkg --configure -a failed: ${describeError(error)}`);
      }

      // Without i386 multi-arch, apt reports a :i386 package as not found.
      if (missingDeps.some(dep => packageNameFor(dep, 'apt').includes(':i386'))) {
        onProgress({ step: 'enable-i386', message: 'Enabling 32-bit (i386) architecture support...', percent: percent() });
        try {
          await runAsRoot(['dpkg', '--add-architecture', 'i386'], sudoPassword);
          results.push('Enabled the i386 architecture');
        } catch (error) {
          // It may already be enabled.
          results.push(`Warning: dpkg --add-architecture i386 failed: ${describeError(error)}`);
        }
      }
    }
    currentStep++;

    // After any architecture change, so the new package lists are fetched.
    stopIfCancelled();
    onProgress({ step: 'update', message: `Updating ${packageManager.manager} package list...`, percent: percent() });
    await runAsRoot(packageManager.update, sudoPassword);
    currentStep++;
    results.push(`Updated the ${packageManager.manager} package list`);

    for (const dep of missingDeps) {
      stopIfCancelled();
      currentStep++;
      const packageName = packageNameFor(dep, packageManager.manager);
      // apt tries the alternatives in order: Ubuntu renames packages between releases.
      const candidates = packageManager.manager === 'apt' && dep.aptAlternatives?.length ? dep.aptAlternatives : [packageName];

      onProgress({ step: 'install', message: `Installing ${dep.name} (${candidates[0]})...`, percent: percent(), dependency: dep.name });

      let installed = false;
      let lastError = '';
      for (const candidate of candidates) {
        try {
          await installPackage(packageManager, candidate, sudoPassword);
          results.push(`Installed ${dep.name} (${candidate})`);
          installed = true;
          break;
        } catch (error) {
          lastError = describeError(error);
          results.push(`${candidate} could not be installed; trying the next alternative`);
        }
      }

      if (!installed) {
        results.push(`Failed to install ${dep.name}: ${lastError}`);

        if (packageManager.manager === 'dnf') {
          stopIfCancelled();
          try {
            results.push(`Retrying ${packageName} with --allowerasing`);
            await installPackage(packageManager, packageName, sudoPassword, ['--allowerasing']);
            results.push(`Installed ${dep.name} (after retrying with --allowerasing)`);
            installed = true;
          } catch (retryError) {
            results.push(`Retry failed for ${dep.name}: ${describeError(retryError)}`);
          }
        }

        if (!installed && dep.required) {
          return {
            success: false,
            message: `Failed to install required dependency: ${dep.name}. See ${installLogPath()} for details.`,
            details: results
          };
        }
      }
    }

    onProgress({ step: 'complete', message: 'Linux dependencies installation completed', percent: 100 });
    return { success: true, message: 'All dependencies installed successfully', details: results };
  } catch (error) {
    if (error instanceof InstallCancelledError) {
      return { success: false, message: error.message, details: results };
    }
    return { success: false, message: `Dependency installation failed: ${describeError(error)}`, details: results };
  }
}

/** True when sudo accepts the password. */
export async function validateSudoPassword(password: string): Promise<boolean> {
  try {
    await runAsRoot(['true'], password);
    return true;
  } catch {
    return false;
  }
}
