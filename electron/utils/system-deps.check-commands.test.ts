// The dependency checks themselves, run by bash against a fake system: a dpkg, an ldconfig and
// library files made for each test, and a PATH holding nothing else.
jest.unmock('child_process');
jest.unmock('fs');
jest.unmock('path');

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LDCONFIG_PATHS, LINUX_DEPENDENCIES, alsaCheckCommand, libc32CheckCommand } from './system-deps.utils';

const bashWorks = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' }).stdout?.trim() === 'ok';
const describeWithBash = bashWorks ? describe : describe.skip;

// What ldconfig -p lists for each C library.
const DEBIAN_I386 = 'libc.so.6 (libc6, OS ABI: Linux 3.2.0) => /lib/i386-linux-gnu/libc.so.6';
const DEBIAN_LIB32 = 'libc.so.6 (libc6, OS ABI: Linux 3.2.0) => /lib32/libc.so.6';
const FEDORA_I686 = 'libc.so.6 (libc6, OS ABI: Linux 3.2.0) => /lib/libc.so.6';
const SIXTY_FOUR = 'libc.so.6 (libc6,x86-64, OS ABI: Linux 3.2.0) => /lib/x86_64-linux-gnu/libc.so.6';
const LIBASOUND = 'libasound.so.2 (libc6,x86-64) => /lib/x86_64-linux-gnu/libasound.so.2';

describeWithBash('the Linux dependency checks', () => {
  let root: string;
  let bin: string;
  /** In the order the checks look: /usr/sbin, /sbin. */
  let ldconfigPaths: string[];

  /** A forward-slash path, which Git Bash on Windows reads as it is. */
  const shellPath = (...parts: string[]) => path.join(root, ...parts).replace(/\\/g, '/');

  function writeScript(file: string, body: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }

  /** An ldconfig at `where` that lists these libraries, printed by the shell itself: nothing else is on the PATH. */
  function ldconfigAt(where: string, ...lines: string[]): void {
    writeScript(where, `printf '\\t%s\\n' ${lines.map(line => `'${line}'`).join(' ')}`);
  }

  /** A dpkg that knows these packages as installed, and no others. */
  function dpkgWith(...installed: string[]): void {
    writeScript(path.join(bin, 'dpkg'), [
      'if [ "$1" = "-s" ]; then',
      `  for package in ${installed.join(' ')}; do`,
      '    if [ "$package" = "$2" ]; then echo "Package: $2"; echo "Status: install ok installed"; exit 0; fi',
      '  done',
      '  echo "dpkg-query: package \'$2\' is not installed" >&2',
      'fi',
      'exit 1'
    ].join('\n'));
  }

  function touch(...parts: string[]): string {
    const file = path.join(root, ...parts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
    return file.replace(/\\/g, '/');
  }

  /** Exit 0 is installed. PATH holds only the test's bin, as a non-root account lacks the sbin directories. */
  function check(command: string): number | null {
    const confined = 'PATH="$(cygpath -u "$TEST_BIN" 2>/dev/null || printf %s "$TEST_BIN")"\n';
    return spawnSync('bash', ['-c', confined + command], { env: { ...process.env, TEST_BIN: bin }, encoding: 'utf8' }).status;
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-deps-'));
    bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    // grep is the one outside command the checks use.
    const grep = spawnSync('bash', ['-c', 'command -v grep'], { encoding: 'utf8' }).stdout.trim();
    writeScript(path.join(bin, 'grep'), `exec "${grep}" "$@"`);
    ldconfigPaths = [shellPath('usr', 'sbin', 'ldconfig'), shellPath('sbin', 'ldconfig')];
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('are the ones the app runs', () => {
    expect(LDCONFIG_PATHS).toEqual(['/usr/sbin/ldconfig', '/sbin/ldconfig']);
    expect(LINUX_DEPENDENCIES.find(dep => dep.name === 'SteamCMD Dependencies (32-bit libraries)')!.checkCommand).toBe(libc32CheckCommand());
    expect(LINUX_DEPENDENCIES.find(dep => dep.name === 'ALSA Audio Library')!.checkCommand).toBe(alsaCheckCommand());
  });

  describe('for the 32-bit C library SteamCMD needs', () => {
    const run = (files: string[] = []) => check(libc32CheckCommand({ ldconfig: ldconfigPaths, files }));

    // Ubuntu: ldconfig is /usr/sbin/ldconfig, and a non-root account's PATH has no /usr/sbin.
    it('finds ldconfig in /usr/sbin when it is not on the PATH', () => {
      ldconfigAt(ldconfigPaths[0], SIXTY_FOUR, DEBIAN_I386);

      expect(run()).toBe(0);
    });

    it('finds ldconfig in /sbin when it is not on the PATH', () => {
      ldconfigAt(ldconfigPaths[1], SIXTY_FOUR, DEBIAN_I386);

      expect(run()).toBe(0);
    });

    it('looks in /usr/sbin and /sbin before the PATH', () => {
      ldconfigAt(path.join(bin, 'ldconfig'), SIXTY_FOUR);
      ldconfigAt(ldconfigPaths[0], SIXTY_FOUR, DEBIAN_I386);

      expect(run()).toBe(0);
    });

    it('still uses an ldconfig that is only on the PATH', () => {
      ldconfigAt(path.join(bin, 'ldconfig'), SIXTY_FOUR, DEBIAN_I386);

      expect(run()).toBe(0);
    });

    it('is missing when ldconfig lists only the 64-bit library', () => {
      ldconfigAt(ldconfigPaths[0], SIXTY_FOUR);

      expect(run()).toBe(1);
    });

    it.each([
      ['Debian\'s libc6-i386', DEBIAN_LIB32],
      ['Fedora\'s glibc.i686', FEDORA_I686]
    ])('recognises %s, whose path does not say i386', (_label, line) => {
      ldconfigAt(ldconfigPaths[0], SIXTY_FOUR, line);

      expect(run()).toBe(0);
    });

    it('takes dpkg\'s word for libc6:i386, with no ldconfig anywhere', () => {
      dpkgWith('libc6:i386');

      expect(run()).toBe(0);
    });

    it('takes dpkg\'s word for libc6-i386', () => {
      dpkgWith('libc6-i386');

      expect(run()).toBe(0);
    });

    it('asks ldconfig when dpkg does not have it', () => {
      dpkgWith('libc6');
      ldconfigAt(ldconfigPaths[0], SIXTY_FOUR);

      expect(run()).toBe(1);
    });

    // A missing ldconfig is not a missing library.
    it('looks for the 32-bit loader when there is no ldconfig at all', () => {
      expect(run([touch('lib', 'ld-linux.so.2')])).toBe(0);
      expect(run([shellPath('lib32', 'ld-linux.so.2')])).toBe(1);
    });
  });

  describe('for the ALSA library, off apt', () => {
    const run = (files: string[] = []) => check(alsaCheckCommand({ ldconfig: ldconfigPaths, files }));

    it('finds ldconfig in /usr/sbin or /sbin when it is not on the PATH', () => {
      ldconfigAt(ldconfigPaths[1], SIXTY_FOUR, LIBASOUND);

      expect(run()).toBe(0);
    });

    it('is missing when ldconfig does not list it', () => {
      ldconfigAt(ldconfigPaths[0], SIXTY_FOUR);

      expect(run()).toBe(1);
    });

    it('looks for the library file when there is no ldconfig at all', () => {
      expect(run([touch('usr', 'lib64', 'libasound.so.2')])).toBe(0);
      expect(run([shellPath('usr', 'lib', 'libasound.so.2')])).toBe(1);
    });
  });
});
