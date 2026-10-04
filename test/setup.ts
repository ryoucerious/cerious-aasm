import { jest } from '@jest/globals';

process.setMaxListeners(20);

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn((name: string) => `/mock/path/${name}`),
    getAppPath: jest.fn(() => '/mock/app/path'),
    on: jest.fn(),
    quit: jest.fn(),
    getVersion: jest.fn(() => '1.0.0'),
    isReady: jest.fn(() => true),
    whenReady: jest.fn(() => Promise.resolve()),
    requestSingleInstanceLock: jest.fn(() => true),
    releaseSingleInstanceLock: jest.fn(),
    setAppUserModelId: jest.fn(),
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadURL: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    close: jest.fn(),
    destroy: jest.fn(),
    isDestroyed: jest.fn(() => false),
    webContents: {
      on: jest.fn(),
      send: jest.fn(),
      openDevTools: jest.fn(),
    },
  })),
  ipcMain: {
    on: jest.fn(),
    handle: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  dialog: {
    showOpenDialog: jest.fn(),
    showSaveDialog: jest.fn(),
    showMessageBox: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
    showItemInFolder: jest.fn(),
  },
}));

jest.mock('child_process', () => ({
  fork: jest.fn(),
  spawn: jest.fn(),
  exec: jest.fn(),
  execSync: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  rmdirSync: jest.fn(),
  rmSync: jest.fn(),
  renameSync: jest.fn(),
  copyFileSync: jest.fn(),
  openSync: jest.fn(),
  fsyncSync: jest.fn(),
  closeSync: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn(),
  copyFile: jest.fn(),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
    unlink: jest.fn(),
    copyFile: jest.fn(),
  },
}));

jest.mock('fs-extra', () => ({
  pathExists: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  ensureDir: jest.fn(),
  remove: jest.fn(),
  copy: jest.fn(),
}));

// join and resolve stay plain '/'-joins because many tests assert exact joined paths;
// relative/isAbsolute use the real posix rules so containment checks behave.
jest.mock('path', () => {
  const posix = (jest.requireActual('path') as typeof import('path')).posix;
  return {
    sep: '/',
    join: jest.fn((...args: string[]) => args.join('/')),
    dirname: jest.fn((p: string) => p.split('/').slice(0, -1).join('/')),
    basename: jest.fn((p: string) => p.split('/').pop()),
    extname: jest.fn((p: string) => {
      const parts = p.split('.');
      return parts.length > 1 ? '.' + parts.pop() : '';
    }),
    resolve: jest.fn((...args: string[]) => args.join('/')),
    relative: jest.fn((from: string, to: string) => posix.relative(from, to)),
    isAbsolute: jest.fn((p: string) => posix.isAbsolute(p)),
  };
});

jest.mock('crypto', () => ({
  randomBytes: jest.fn((size: number) => Buffer.alloc(size, 'mock-random-bytes')),
  randomUUID: jest.fn(() => (jest.requireActual('crypto') as typeof import('crypto')).randomUUID()),
  randomInt: jest.fn((min: number, max?: number) => {
    const actual = jest.requireActual('crypto') as typeof import('crypto');
    return max === undefined ? actual.randomInt(min) : actual.randomInt(min, max);
  }),
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn(() => 'mock-hash'),
  })),
  createCipheriv: jest.fn(() => ({
    update: jest.fn(() => 'encrypted'),
    final: jest.fn(() => ''),
    getAuthTag: jest.fn(() => Buffer.from('mock-auth-tag')),
  })),
  createDecipheriv: jest.fn(() => ({
    setAuthTag: jest.fn(),
    update: jest.fn(() => 'decrypted'),
    final: jest.fn(() => ''),
  })),
}));

// Real cost-12 hashes take a quarter second each, and auth-config.test relies on the
// predictable `hashed_` output.
jest.mock('bcrypt', () => ({
  hash: jest.fn((password: string, saltRounds: number) => Promise.resolve(`hashed_${password}`)),
  compare: jest.fn((password: string, hash: string) => Promise.resolve(true)),
  genSalt: jest.fn((rounds: number) => Promise.resolve('mock_salt')),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
});
