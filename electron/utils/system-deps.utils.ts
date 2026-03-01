import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { getPlatform } from './platform.utils';

export interface LinuxDependency {
  name: string;
  packageName: string | { [key: string]: string }; // Support per-distro package names
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
    name: 'Font Configuration',
    packageName: 'fontconfig',
    checkCommand: 'fc-list',
    description: 'Font configuration for better Proton compatibility',
    required: false
  }
];

/**
 * Checks if a single dependency is installed
 */
export async function checkDependency(dependency: LinuxDependency): Promise<DependencyCheckResult> {
  return new Promise((resolve) => {
    if (getPlatform() !== 'linux') {
      resolve({ dependency, installed: true, version: 'N/A (not Linux)' });
      return;
    }

    const proc = spawn('bash', ['-c', dependency.checkCommand], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Timeout after 5 seconds
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ dependency, installed: false });
    }, 5000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const installed = code === 0;
      let version = '';
      
      if (installed && stdout) {
        // Try to extract version from first line of output
        const firstLine = stdout.split('\n')[0];
        const versionMatch = firstLine.match(/\d+\.\d+[\.\d]*/);
        version = versionMatch ? versionMatch[0] : 'installed';
      }

      resolve({
        dependency,
        installed,
        version: installed ? version : undefined
      });
    });
  });
}

/**
 * Checks all Linux dependencies
 */
export async function checkAllDependencies(): Promise<DependencyCheckResult[]> {
  const results: DependencyCheckResult[] = [];
  
  for (const dependency of LINUX_DEPENDENCIES) {
    const result = await checkDependency(dependency);
    results.push(result);
  }
  
  return results;
}

/**
 * Gets the correct package name for the current distribution
 */
export function getPackageNameForDistribution(dependency: LinuxDependency): string {
  if (typeof dependency.packageName === 'string') {
    return dependency.packageName;
  }

  const pkgInfo = getPackageManagerInfo();
  if (!pkgInfo) {
    // Fallback to first available package name
    return Object.values(dependency.packageName)[0];
  }

  // Return the package name for the current package manager, or fallback
  return dependency.packageName[pkgInfo.manager] || dependency.packageName['apt'] || Object.values(dependency.packageName)[0];
}

/**
 * Generates manual installation instructions for missing dependencies
 */
export function generateInstallInstructions(missingDeps: LinuxDependency[]): string {
  const pkgInfo = getPackageManagerInfo();
  if (!pkgInfo) {
    return 'Could not detect package manager. Please install the missing dependencies manually.';
  }

  const packageNames = missingDeps.map(dep => getPackageNameForDistribution(dep));
  const packageList = packageNames.join(' ');

  let instructions = `To install the missing dependencies, run the following command:\n\n`;
  
  switch (pkgInfo.manager) {
    case 'dnf':
      instructions += `sudo dnf install ${packageList}\n\n`;
      instructions += `For Fedora users, you may also need to enable RPM Fusion repositories:\n`;
      instructions += `sudo dnf install https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm`;
      break;
    case 'yum':
      instructions += `sudo yum install ${packageList}`;
      break;
    case 'apt':
      instructions += `sudo apt-get update && sudo apt-get install ${packageList}`;
      break;
    case 'pacman':
      instructions += `sudo pacman -S ${packageList}`;
      break;
    case 'zypper':
      instructions += `sudo zypper install ${packageList}`;
      break;
    default:
      instructions += `Using your package manager, install: ${packageList}`;
  }

  return instructions;
}

/**
 * Gets the package manager command for the current Linux distribution
 */
export function getPackageManagerInfo(): { manager: string; installCmd: string; updateCmd: string; installExtra?: string } | null {
  if (getPlatform() !== 'linux') {
    return null;
  }

  try {
    // Check for common package managers
    if (fs.existsSync('/usr/bin/apt') || fs.existsSync('/usr/bin/apt-get')) {
      return {
        manager: 'apt',
        installCmd: 'apt-get install -y',
        updateCmd: 'apt-get update'
      };
    } else if (fs.existsSync('/usr/bin/dnf')) {
      return {
        manager: 'dnf',
        installCmd: 'dnf install -y',
        // Use makecache to update metadata without performing a full system upgrade
        updateCmd: 'dnf makecache',
        installExtra: ''
      };
    } else if (fs.existsSync('/usr/bin/yum')) {
      return {
        manager: 'yum',
        installCmd: 'yum install -y',
        // Use makecache for yum as well to avoid full system upgrades
        updateCmd: 'yum makecache'
      };
    } else if (fs.existsSync('/usr/bin/dnf')) {
      return {
        manager: 'dnf',
        installCmd: 'dnf install -y',
        // Use makecache to update metadata without performing a full system upgrade
        updateCmd: 'dnf makecache',
        // optional extra flags (e.g. --allowerasing) can be appended when needed
        installExtra: ''
      };
    } else if (fs.existsSync('/usr/bin/pacman')) {
      return {
        manager: 'pacman',
        installCmd: 'pacman -S --noconfirm',
        updateCmd: 'pacman -Sy'
      };
    } else if (fs.existsSync('/usr/bin/zypper')) {
      return {
        manager: 'zypper',
        installCmd: 'zypper install -y',
        updateCmd: 'zypper refresh'
      };
    }
  } catch (error) {
    console.error('Error detecting package manager:', error);
  }

  return null;
}

/**
 * Installs missing Linux dependencies with sudo password
 */
export async function installMissingDependencies(
  missingDeps: LinuxDependency[],
  sudoPassword: string,
  onProgress: (progress: LinuxDepsInstallProgress) => void
): Promise<{ success: boolean; message: string; details: string[] }> {
  if (getPlatform() !== 'linux') {
    return { success: true, message: 'Not running on Linux, dependencies not required', details: [] };
  }

  if (missingDeps.length === 0) {
    return { success: true, message: 'All dependencies already installed', details: [] };
  }

  const pkgInfo = getPackageManagerInfo();
  if (!pkgInfo) {
    return { 
      success: false, 
      message: 'Could not detect package manager. Supported: apt, yum, dnf, pacman, zypper', 
      details: [] 
    };
  }

  const results: string[] = [];
  const totalSteps = missingDeps.length + 2; // +1 for dpkg fix, +1 for package manager update
  let currentStep = 0;

  try {
    // Step 0: apt-specific pre-flight
    if (pkgInfo.manager === 'apt') {
      // Step 0a: Fix any interrupted dpkg configurations
      onProgress({
        step: 'dpkg-fix',
        message: 'Fixing any interrupted package configurations...',
        percent: Math.round((currentStep / totalSteps) * 100)
      });
      try {
        await runSudoCommand('dpkg --configure -a', sudoPassword);
        results.push('✓ Fixed dpkg configurations');
      } catch (error) {
        results.push(`⚠ dpkg fix warning: ${error}`);
      }

      // Step 0b: Enable i386 multi-arch if any dep uses an :i386 package.
      // Without this, apt simply reports the package as "not found".
      const needs32bit = missingDeps.some(d => {
        const pkg = typeof d.packageName === 'string' ? d.packageName : (d.packageName['apt'] || '');
        return pkg.includes(':i386') || pkg.includes(':i386');
      });
      if (needs32bit) {
        onProgress({
          step: 'enable-i386',
          message: 'Enabling 32-bit (i386) architecture support...',
          percent: Math.round((currentStep / totalSteps) * 100)
        });
        try {
          await runSudoCommand('dpkg --add-architecture i386', sudoPassword);
          results.push('✓ Enabled i386 architecture');
        } catch (error) {
          // May already be enabled — log and continue
          results.push(`⚠ dpkg add-architecture i386: ${error}`);
        }
      }

      currentStep++;
    } else {
      currentStep++; // Skip apt pre-flight for non-apt systems
    }

    // Step 1: Update package manager (always after any arch changes)
    onProgress({
      step: 'update',
      message: `Updating ${pkgInfo.manager} package list...`,
      percent: Math.round((currentStep / totalSteps) * 100)
    });

    await runSudoCommand(pkgInfo.updateCmd, sudoPassword);
    currentStep++;
    results.push(`✓ Updated ${pkgInfo.manager} package list`);

    // Step 2+: Install each missing dependency
    for (const dep of missingDeps) {
      currentStep++;
      const percent = Math.round((currentStep / totalSteps) * 100);
      const packageName = getPackageNameForDistribution(dep);
      
      onProgress({
        step: 'install',
        message: `Installing ${dep.name} (${packageName})...`,
        percent,
        dependency: dep.name
      });

        try {
          // include any extra install flags (e.g. --allowerasing for dnf) if provided
          const extra = (pkgInfo as any).installExtra ? `${(pkgInfo as any).installExtra} ` : '';
          const installCommand = `${pkgInfo.installCmd} ${extra}${packageName}`.trim();
          await runSudoCommand(installCommand, sudoPassword);
          results.push(`✓ Installed ${dep.name}`);
        } catch (error) {
          const errDetail = error instanceof Error ? error.message : String(error);
          const errorMsg = `✗ Failed to install ${dep.name} (${packageName}): ${errDetail}`;
          results.push(errorMsg);

          // If using dnf, attempt a safe retry with --allowerasing once (may allow resolving multilib conflicts)
          if (pkgInfo.manager === 'dnf') {
            try {
              const retryCmd = `${pkgInfo.installCmd} --allowerasing ${packageName}`.trim();
              results.push(`! Retry with --allowerasing: ${retryCmd}`);
              await runSudoCommand(retryCmd, sudoPassword);
              results.push(`✓ Installed ${dep.name} (after retry with --allowerasing)`);
              continue; // next dependency
            } catch (retryError) {
              results.push(`✗ Retry failed for ${dep.name}: ${retryError}`);
            }
          }

          if (dep.required) {
            return {
              success: false,
              message: `Failed to install ${dep.name} (${packageName}): ${errDetail}. See /tmp/cerious-aasm-deps-install.log for details.`,
              details: results
            };
          }
        }
    }

    onProgress({
      step: 'complete',
      message: 'Linux dependencies installation completed',
      percent: 100
    });

    return {
      success: true,
      message: 'All dependencies installed successfully',
      details: results
    };

  } catch (error) {
    return {
      success: false,
      message: `Dependency installation failed: ${error}`,
      details: results
    };
  }
}

/**
 * Runs a command with sudo privileges using the provided password
 */
async function runSudoCommand(command: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('sudo', ['-S', 'bash', '-c', command], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // (close/error handlers are attached later after timeout so we can log failures)

    // Send password to sudo and keep stdin open so interactive programs don't receive EOF
    try {
      proc.stdin?.write(`${password}\n`);
    } catch (e) {
      // ignore
    }

    // Timeout after 5 minutes
    const timeoutMs = 5 * 60 * 1000;
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Command timed out'));
    }, timeoutMs);

    // On non-zero exit we append stdout/stderr to a log for debugging
    proc.on('close', (code) => {
      clearTimeout(timeout);
      // Ensure stdin is closed now that the process is finished
      try { proc.stdin?.end(); } catch (e) { /* ignore */ }
      if (code === 0) {
        resolve(stdout);
      } else {
        try {
          const logPath = '/tmp/cerious-aasm-deps-install.log';
          const entry = `\n==== Failed command: ${command} ===\nExit code: ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}\n`;
          fs.appendFileSync(logPath, entry);
        } catch (e) {
          // ignore logging errors
        }
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
      }
    });
    proc.on('error', (error) => {
      reject(error);
    });

  });
}

/**
 * Validates sudo password
 */
export async function validateSudoPassword(password: string): Promise<boolean> {
  try {
    await runSudoCommand('echo "sudo test"', password);
    return true;
  } catch {
    return false;
  }
}
