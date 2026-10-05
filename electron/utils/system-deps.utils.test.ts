import { EventEmitter } from 'events';
import * as fs from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { getPlatform } from './platform.utils';
import {
  LINUX_DEPENDENCIES,
  checkAllDependencies,
  checkDependency,
  findDependencies,
  generateInstallInstructions,
  getPackageManagerInfo,
  getPackageNameForDistribution,
  installMissingDependencies,
  validateSudoPassword,
  type LinuxDependency
} from './system-deps.utils';

jest.mock('fs', () => ({ existsSync: jest.fn(), mkdirSync: jest.fn(), appendFileSync: jest.fn() }));
jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('./platform.utils', () => ({ getPlatform: jest.fn() }));

const mockFs = jest.mocked(fs);
const mockSpawn = jest.mocked(spawn);
// sudo's env_reset drops variables set on sudo itself, so the command runs under env.
const SUDO = ['-S', '-k', '-p', '', '--', 'env', 'DEBIAN_FRONTEND=noninteractive'];
const LOG_FILE = '/mock/path/logs/linux-deps-install.log';

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: jest.Mock; end: jest.Mock; on: jest.Mock };
  kill: jest.Mock;
};

function fakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() },
    kill: jest.fn()
  });
}

/** Every spawned command exits with the next code in turn (then 0), printing `stderr` when it fails. */
function commandsExit(...codes: number[]): FakeChild[] {
  const children: FakeChild[] = [];
  mockSpawn.mockImplementation(() => {
    const child = fakeChild();
    const code = codes.length > 0 ? codes.shift()! : 0;
    children.push(child);
    process.nextTick(() => {
      if (code !== 0) child.stderr.emit('data', Buffer.from('E: Unable to locate package'));
      child.emit('close', code);
    });
    return child as unknown as ChildProcess;
  });
  return children;
}

function sudoCommands(): string[][] {
  return mockSpawn.mock.calls.filter(([command]) => command === 'sudo').map(([, args]) => [...(args as string[])]);
}

function usePackageManager(manager: 'apt' | 'dnf' | 'pacman' | null): void {
  mockFs.existsSync.mockImplementation(file => manager !== null && String(file).includes(manager));
}

describe('system-deps.utils', () => {
  beforeEach(() => {
    jest.mocked(getPlatform).mockReturnValue('linux');
    mockSpawn.mockReset();
    mockFs.existsSync.mockReset();
    mockFs.appendFileSync.mockReset();
  });

  describe('LINUX_DEPENDENCIES', () => {
    it('lists what the server needs', () => {
      expect(LINUX_DEPENDENCIES.map(dep => dep.name)).toEqual([
        'cURL', 'Unzip', 'Tar', 'Xvfb', 'SteamCMD Dependencies (32-bit libraries)', 'ALSA Audio Library', 'Font Configuration'
      ]);
    });

    it('should accept libasound2t64, accept real libasound2 when t64 is not packaged, and reject the Ubuntu 24.04 stub', () => {
      const cmd = LINUX_DEPENDENCIES[5].checkCommand;

      // Ubuntu 24.04: installed libasound2t64 passes before any other branch.
      expect(cmd).toContain('dpkg -l libasound2t64');
      expect(cmd).toContain('exit 0');

      // t64 is in the apt cache but not installed: the transitional stub fails.
      expect(cmd).toContain('apt-cache show libasound2t64');
      expect(cmd).toContain('exit 1');

      // Debian Bookworm / Ubuntu 22.04: no t64 package, and libasound2 ships the .so.
      expect(cmd).toContain('dpkg -L libasound2');
      expect(cmd).toContain('libasound\\.so\\.2');

      const t64Install = cmd.indexOf('dpkg -l libasound2t64');
      const t64InCache = cmd.indexOf('apt-cache show libasound2t64');
      const realLibasound2 = cmd.indexOf('dpkg -L libasound2');
      expect(t64Install).toBeGreaterThanOrEqual(0);
      expect(t64Install).toBeLessThan(t64InCache);
      expect(t64InCache).toBeLessThan(realLibasound2);
    });

    it('only names packages the install validation accepts', () => {
      const names = LINUX_DEPENDENCIES.flatMap(dep => [
        ...(typeof dep.packageName === 'string' ? [dep.packageName] : Object.values(dep.packageName)),
        ...(dep.aptAlternatives ?? [])
      ]);
      for (const name of names) {
        expect(name).toMatch(/^[a-z0-9][a-z0-9.+:_-]*$/i);
      }
    });
  });

  describe('checkDependency', () => {
    it('is always installed off Linux', async () => {
      jest.mocked(getPlatform).mockReturnValue('windows');

      await expect(checkDependency(LINUX_DEPENDENCIES[0])).resolves.toEqual(
        expect.objectContaining({ installed: true, version: 'N/A (not Linux)' })
      );
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('runs the check command and reads the version', async () => {
      const child = fakeChild();
      mockSpawn.mockReturnValue(child as unknown as ChildProcess);

      const pending = checkDependency(LINUX_DEPENDENCIES[2]);
      child.stdout.emit('data', Buffer.from('tar (GNU tar) 1.30\nCopyright (C) 2017 Free Software Foundation, Inc.'));
      child.emit('close', 0);

      await expect(pending).resolves.toEqual(expect.objectContaining({ installed: true, version: '1.30' }));
      expect(mockSpawn).toHaveBeenCalledWith('bash', ['-c', 'tar --version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    });

    it('reports a failing check as missing', async () => {
      commandsExit(1);

      await expect(checkDependency(LINUX_DEPENDENCIES[0])).resolves.toEqual(
        expect.objectContaining({ installed: false, version: undefined })
      );
    });

    it('reports a check that cannot be started as missing', async () => {
      const child = fakeChild();
      mockSpawn.mockReturnValue(child as unknown as ChildProcess);

      const pending = checkDependency(LINUX_DEPENDENCIES[0]);
      child.emit('error', Object.assign(new Error('spawn bash ENOENT'), { code: 'ENOENT' }));

      await expect(pending).resolves.toEqual(expect.objectContaining({ installed: false }));
    });

    it('gives up on a check that hangs', async () => {
      jest.useFakeTimers();
      const child = fakeChild();
      mockSpawn.mockReturnValue(child as unknown as ChildProcess);

      const pending = checkDependency(LINUX_DEPENDENCIES[0]);
      jest.advanceTimersByTime(5000);

      await expect(pending).resolves.toEqual(expect.objectContaining({ installed: false }));
      expect(child.kill).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('checks every dependency', async () => {
      jest.mocked(getPlatform).mockReturnValue('windows');

      const results = await checkAllDependencies();

      expect(results.map(result => result.dependency)).toEqual(LINUX_DEPENDENCIES);
    });
  });

  describe('package managers', () => {
    it.each([
      ['apt', { manager: 'apt', install: ['apt-get', 'install', '-y'], update: ['apt-get', 'update'] }],
      ['dnf', { manager: 'dnf', install: ['dnf', 'install', '-y'], update: ['dnf', 'makecache'] }],
      ['pacman', { manager: 'pacman', install: ['pacman', '-S', '--noconfirm'], update: ['pacman', '-Sy'] }]
    ] as const)('detects %s', (manager, expected) => {
      usePackageManager(manager);

      expect(getPackageManagerInfo()).toEqual(expected);
    });

    it('finds none off Linux or when nothing is known', () => {
      usePackageManager(null);
      expect(getPackageManagerInfo()).toBeNull();

      jest.mocked(getPlatform).mockReturnValue('windows');
      usePackageManager('apt');
      expect(getPackageManagerInfo()).toBeNull();
    });

    it('names the package for the detected manager', () => {
      usePackageManager('dnf');

      expect(getPackageNameForDistribution(LINUX_DEPENDENCIES[3])).toBe('xorg-x11-server-Xvfb');
      expect(getPackageNameForDistribution(LINUX_DEPENDENCIES[0])).toBe('curl');
    });

    it('falls back to the first package name without a known manager', () => {
      usePackageManager(null);

      expect(getPackageNameForDistribution(LINUX_DEPENDENCIES[3])).toBe('xvfb');
    });

    it.each([
      ['apt', 'sudo apt-get update && sudo apt-get install curl unzip'],
      ['dnf', 'sudo dnf install curl unzip'],
      ['pacman', 'sudo pacman -S curl unzip']
    ] as const)('writes %s instructions', (manager, command) => {
      usePackageManager(manager);

      expect(generateInstallInstructions([LINUX_DEPENDENCIES[0], LINUX_DEPENDENCIES[1]])).toContain(command);
    });

    it('explains when the package manager is unknown', () => {
      usePackageManager(null);

      expect(generateInstallInstructions([LINUX_DEPENDENCIES[0]])).toContain('Could not detect package manager');
    });
  });

  describe('findDependencies', () => {
    it('looks names up in the known list', () => {
      expect(findDependencies(['Xvfb', 'cURL'])).toEqual([LINUX_DEPENDENCIES[3], LINUX_DEPENDENCIES[0]]);
    });

    it.each([
      [['Xvfb', 'curl; rm -rf /']],
      [[{ name: 'Xvfb', packageName: 'curl; rm -rf /' }]],
      [[42]]
    ])('refuses anything that is not a known name: %p', names => {
      expect(findDependencies(names)).toBeUndefined();
    });
  });

  describe('installMissingDependencies', () => {
    beforeEach(() => usePackageManager('apt'));

    it('has nothing to do off Linux', async () => {
      jest.mocked(getPlatform).mockReturnValue('windows');

      await expect(installMissingDependencies(['cURL'], 'pw', jest.fn())).resolves.toEqual(
        expect.objectContaining({ success: true, message: 'Not running on Linux, dependencies not required' })
      );
    });

    it('has nothing to do for an empty list', async () => {
      await expect(installMissingDependencies([], 'pw', jest.fn())).resolves.toEqual(
        expect.objectContaining({ success: true, message: 'All dependencies already installed' })
      );
    });

    it('refuses a name it does not know, without running anything', async () => {
      const result = await installMissingDependencies(['cURL', 'curl; reboot'], 'pw', jest.fn());

      expect(result.success).toBe(false);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('fails without a known package manager', async () => {
      usePackageManager(null);

      await expect(installMissingDependencies(['cURL'], 'pw', jest.fn())).resolves.toEqual(
        expect.objectContaining({ success: false, message: expect.stringContaining('Could not detect package manager') })
      );
    });

    it('runs each step through sudo as an argument list, never through a shell', async () => {
      commandsExit();
      const onProgress = jest.fn();

      const result = await installMissingDependencies(['cURL'], 'hunter2', onProgress);

      expect(result.success).toBe(true);
      expect(sudoCommands()).toEqual([
        [...SUDO, 'dpkg', '--configure', '-a'],
        [...SUDO, 'apt-get', 'update'],
        [...SUDO, 'apt-get', 'install', '-y', 'curl']
      ]);
      expect(mockSpawn.mock.calls.every(([command]) => command === 'sudo')).toBe(true);
      expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ step: 'complete', percent: 100 }));
    });

    it('gives the password to sudo on stdin, closes it, and keeps apt from prompting', async () => {
      const children = commandsExit();

      await installMissingDependencies(['cURL'], 'hunter2', jest.fn());

      expect(mockSpawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['env', 'DEBIAN_FRONTEND=noninteractive']));
      expect(mockSpawn.mock.calls[0][2]).toEqual({ stdio: ['pipe', 'pipe', 'pipe'] });
      for (const child of children) {
        expect(child.stdin.write).toHaveBeenCalledWith('hunter2\n');
        expect(child.stdin.end).toHaveBeenCalled();
        expect(child.stdin.write.mock.invocationCallOrder[0]).toBeLessThan(child.stdin.end.mock.invocationCallOrder[0]);
      }
      expect(JSON.stringify(mockSpawn.mock.calls)).not.toContain('hunter2');
    });

    it('sends no password when the app already runs as root', async () => {
      const getuid = Object.getOwnPropertyDescriptor(process, 'getuid');
      Object.defineProperty(process, 'getuid', { value: () => 0, configurable: true });
      try {
        const children = commandsExit();

        await installMissingDependencies(['cURL'], 'hunter2', jest.fn());

        for (const child of children) {
          expect(child.stdin.write).not.toHaveBeenCalled();
          expect(child.stdin.end).toHaveBeenCalled();
        }
      } finally {
        if (getuid) Object.defineProperty(process, 'getuid', getuid);
        else delete (process as { getuid?: unknown }).getuid;
      }
    });

    // Killing apt or dpkg half way through can leave the package database broken.
    it('stops between packages on cancel, never in the middle of one', async () => {
      const controller = new AbortController();
      const children = commandsExit();
      const onProgress = jest.fn((progress: { step: string; dependency?: string }) => {
        if (progress.step === 'install' && progress.dependency === 'cURL') controller.abort();
      });

      const result = await installMissingDependencies(['cURL', 'Unzip'], 'pw', onProgress, controller.signal);

      expect(result).toEqual(expect.objectContaining({ success: false, message: 'Install cancelled.' }));
      expect(sudoCommands()).toEqual([
        [...SUDO, 'dpkg', '--configure', '-a'],
        [...SUDO, 'apt-get', 'update'],
        [...SUDO, 'apt-get', 'install', '-y', 'curl']
      ]);
      expect(children.every(child => !child.kill.mock.calls.length)).toBe(true);
    });

    it('runs nothing when cancelled before it starts', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await installMissingDependencies(['cURL'], 'pw', jest.fn(), controller.signal);

      expect(result).toEqual(expect.objectContaining({ success: false, message: 'Install cancelled.' }));
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('enables i386 before installing a 32-bit package', async () => {
      commandsExit();

      await installMissingDependencies(['SteamCMD Dependencies (32-bit libraries)'], 'pw', jest.fn());

      expect(sudoCommands()).toEqual([
        [...SUDO, 'dpkg', '--configure', '-a'],
        [...SUDO, 'dpkg', '--add-architecture', 'i386'],
        [...SUDO, 'apt-get', 'update'],
        [...SUDO, 'apt-get', 'install', '-y', 'libc6:i386']
      ]);
    });

    it('tries the apt alternatives in order', async () => {
      commandsExit(0, 0, 100);

      const result = await installMissingDependencies(['ALSA Audio Library'], 'pw', jest.fn());

      expect(result.success).toBe(true);
      expect(sudoCommands().slice(2)).toEqual([
        [...SUDO, 'apt-get', 'install', '-y', 'libasound2t64'],
        [...SUDO, 'apt-get', 'install', '-y', 'libasound2']
      ]);
    });

    it('retries a failed dnf install with --allowerasing', async () => {
      usePackageManager('dnf');
      commandsExit(0, 1, 0);

      const result = await installMissingDependencies(['cURL'], 'pw', jest.fn());

      expect(result.success).toBe(true);
      expect(sudoCommands()).toEqual([
        [...SUDO, 'dnf', 'makecache'],
        [...SUDO, 'dnf', 'install', '-y', 'curl'],
        [...SUDO, 'dnf', 'install', '-y', '--allowerasing', 'curl']
      ]);
    });

    it('carries on past an optional package that fails', async () => {
      commandsExit(0, 0, 100);

      const result = await installMissingDependencies(['Font Configuration'], 'pw', jest.fn());

      expect(result.success).toBe(true);
      expect(result.details).toContainEqual(expect.stringContaining('Failed to install Font Configuration'));
    });

    it('fails on a required package, pointing at a log in the app log folder', async () => {
      commandsExit(0, 0, 100);

      const result = await installMissingDependencies(['cURL'], 'hunter2', jest.fn());

      expect(result.success).toBe(false);
      expect(result.message).toBe(`Failed to install required dependency: cURL. See ${LOG_FILE} for details.`);
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/mock/path/logs', { recursive: true });
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(LOG_FILE, expect.stringContaining('apt-get install -y curl'));
      expect(JSON.stringify(mockFs.appendFileSync.mock.calls)).not.toContain('hunter2');
    });

    it('fails when the package list cannot be updated', async () => {
      commandsExit(0, 100);

      const result = await installMissingDependencies(['cURL'], 'pw', jest.fn());

      expect(result.success).toBe(false);
      expect(result.message).toContain('Dependency installation failed');
    });

    it('fails, rather than throwing, when sudo cannot be started', async () => {
      mockSpawn.mockImplementation(() => {
        const child = fakeChild();
        process.nextTick(() => child.emit('error', Object.assign(new Error('spawn sudo ENOENT'), { code: 'ENOENT' })));
        return child as unknown as ChildProcess;
      });

      const result = await installMissingDependencies(['cURL'], 'pw', jest.fn());

      expect(result.success).toBe(false);
      expect(result.message).toContain('spawn sudo ENOENT');
    });

    describe('with a package name that is not safe to pass on', () => {
      const unsafe: LinuxDependency[] = [
        { name: 'Unsafe (shell)', packageName: 'curl; reboot', checkCommand: 'true', description: '', required: true },
        { name: 'Unsafe (option)', packageName: '--allow-remove-essential', checkCommand: 'true', description: '', required: true }
      ];

      beforeEach(() => LINUX_DEPENDENCIES.push(...unsafe));
      afterEach(() => LINUX_DEPENDENCIES.splice(LINUX_DEPENDENCIES.length - unsafe.length));

      it.each(unsafe.map(dep => dep.name))('never hands %s to the package manager', async name => {
        commandsExit();

        const result = await installMissingDependencies([name], 'pw', jest.fn());

        expect(result.success).toBe(false);
        expect(sudoCommands().some(args => args.includes('install'))).toBe(false);
      });
    });

    describe('when a command hangs', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      // A big apt download on a slow mirror can take several minutes, and killing apt part way
      // through can leave dpkg needing repair.
      it('gives it fifteen minutes, then stops it and says how to repair dpkg', async () => {
        const child = fakeChild();
        mockSpawn.mockReturnValue(child as unknown as ChildProcess);

        const pending = installMissingDependencies(['cURL'], 'pw', jest.fn());
        await jest.advanceTimersByTimeAsync(15 * 60 * 1000 - 1);
        expect(child.kill).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        expect(child.kill).toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('sudo dpkg --configure -a'));
        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);
        await expect(pending).resolves.toEqual(expect.objectContaining({ success: false }));
      });

      it('gives no dpkg advice for another package manager', async () => {
        usePackageManager('dnf');
        const child = fakeChild();
        mockSpawn.mockReturnValue(child as unknown as ChildProcess);

        const pending = installMissingDependencies(['cURL'], 'pw', jest.fn());
        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

        expect(child.kill).toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/^\[system-deps\] dnf .*still running after 15 minutes/));
        expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('dpkg'));
        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);
        await expect(pending).resolves.toEqual(expect.objectContaining({ success: false }));
      });
    });
  });

  describe('validateSudoPassword', () => {
    it('accepts a password sudo takes', async () => {
      const children = commandsExit();

      await expect(validateSudoPassword('hunter2')).resolves.toBe(true);

      expect(sudoCommands()).toEqual([[...SUDO, 'true']]);
      expect(children[0].stdin.write).toHaveBeenCalledWith('hunter2\n');
      expect(children[0].stdin.end).toHaveBeenCalled();
    });

    it('refuses a password sudo rejects', async () => {
      commandsExit(1);

      await expect(validateSudoPassword('wrong')).resolves.toBe(false);
    });
  });
});
