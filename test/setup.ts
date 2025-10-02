import { jest } from '@jest/globals';

// Increase the Node.js process event listener limit to 20
process.setMaxListeners(20);

// Mock Electron APIs
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
  ipcRenderer: {
    on: jest.fn(),
    send: jest.fn(),
    invoke: jest.fn(),
  },
  dialog: {
    showOpenDialog: jest.fn(),
    showSaveDialog: jest.fn(),
    showMessageBox: jest.fn(),
  },
  Menu: {
    setApplicationMenu: jest.fn(),
    buildFromTemplate: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
    showItemInFolder: jest.fn(),
  },
  nativeTheme: {
    shouldUseDarkColors: false,
    on: jest.fn(),
  },
}));

// Mock child_process
jest.mock('child_process', () => ({
  fork: jest.fn(),
  spawn: jest.fn(),
  exec: jest.fn(),
  execSync: jest.fn(),
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  rmdirSync: jest.fn(),
  renameSync: jest.fn(),
  copyFileSync: jest.fn(),
  // Async versions
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

// Mock fs-extra
jest.mock('fs-extra', () => ({
  pathExists: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  ensureDir: jest.fn(),
  remove: jest.fn(),
  copy: jest.fn(),
}));

// Mock path
jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
  dirname: jest.fn((p: string) => p.split('/').slice(0, -1).join('/')),
  basename: jest.fn((p: string) => p.split('/').pop()),
  extname: jest.fn((p: string) => {
    const parts = p.split('.');
    return parts.length > 1 ? '.' + parts.pop() : '';
  }),
  resolve: jest.fn((...args: string[]) => args.join('/')),
}));

// Mock crypto
jest.mock('crypto', () => ({
  randomBytes: jest.fn((size: number) => Buffer.alloc(size, 'mock-random-bytes')),
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

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn((password: string, saltRounds: number) => Promise.resolve(`hashed_${password}`)),
  compare: jest.fn((password: string, hash: string) => Promise.resolve(true)),
  genSalt: jest.fn((rounds: number) => Promise.resolve('mock_salt')),
}));

// Global test utilities
declare global {
  var testUtils: {
    mockFn: () => jest.MockedFunction<any>;
    wait: (ms: number) => Promise<void>;
    mockProcess: {
      send: jest.MockedFunction<any>;
      on: jest.MockedFunction<any>;
      exit: jest.MockedFunction<any>;
    };
    resetAllMocks: () => void;
  };
}

global.testUtils = {
  // Helper to create mock functions with jest
  mockFn: () => jest.fn(),

  // Helper to wait for async operations
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),

  // Helper to mock process methods
  mockProcess: {
    send: jest.fn(),
    on: jest.fn(),
    exit: jest.fn(),
  },

  // Helper to reset all mocks
  resetAllMocks: () => {
    jest.clearAllMocks();
  },
};

// Set up global test environment
beforeEach(() => {
  jest.clearAllMocks();
  // Mock console methods to reduce noise in test output
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllTimers();
  // Restore console methods after each test
  jest.restoreAllMocks();
});