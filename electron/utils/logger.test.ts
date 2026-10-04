import { jest } from '@jest/globals';

// Mock the exact specifier logger.ts imports ('electron-log'). Mocking
// 'electron-log/main' silently missed, letting the real module load and throw
// "this.initializeFn is not a function" on log.initialize().
jest.mock('electron-log', () => {
  const mockLog: any = {
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    initialize: jest.fn(),
    transports: {
      file: {
        level: 'debug',
        maxSize: 0,
        format: '',
        resolvePathFn: null as any,
        getFile: jest.fn(() => ({ path: '/mock/logs/cerious-aasm.log' })),
      },
      console: {
        level: 'info',
        format: '',
      },
    },
  };
  return { __esModule: true, default: mockLog };
});

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/userData'),
  },
}));
jest.mock('os', () => ({ homedir: jest.fn(() => '/home/user') }));

describe('logger', () => {
  it('should export getLogFilePath function', () => {
    const { getLogFilePath } = require('./logger');
    expect(typeof getLogFilePath).toBe('function');
  });

  it('should return path from electron-log file transport', () => {
    const { getLogFilePath } = require('./logger');
    const result = getLogFilePath();
    expect(result).toBe('/mock/logs/cerious-aasm.log');
  });

  it('should export default log instance', () => {
    // logger.ts wires everything up in top-level side effects that run once per module
    // registry. An earlier test already required it, and the global beforeEach clears
    // mock call records, so the registry must be reset for those side effects to re-run.
    jest.resetModules();
    const logModule = require('./logger');
    expect(logModule.default).toBeDefined();
    expect(logModule.default.initialize).toHaveBeenCalled();
  });

  it('should configure file transport settings', () => {
    const log = require('electron-log').default;
    expect(log.transports.file.level).toBe('debug');
  });

  describe('log file path', () => {
    const originalPlatform = process.platform;
    const originalEnv = { APPDATA: process.env.APPDATA, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
    let resolvePath: () => string;
    let getPath: jest.Mock;

    beforeEach(() => {
      require('./logger');
      resolvePath = require('electron-log').default.transports.file.resolvePathFn;
      getPath = require('electron').app.getPath;
      getPath.mockReturnValue('/mock/userData');
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      for (const [name, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    it("is in the logs folder of Electron's user data", () => {
      expect(resolvePath()).toBe('/mock/userData/logs/cerious-aasm.log');
      expect(getPath).toHaveBeenCalledWith('userData');
    });

    // Electron names the user data folder after package.json's name, not the product name.
    it.each([
      ['win32', { APPDATA: 'C:/Users/user/AppData/Roaming' }, 'C:/Users/user/AppData/Roaming/cerious-aasm/logs/cerious-aasm.log'],
      ['linux', { XDG_CONFIG_HOME: '/home/user/.xdg' }, '/home/user/.xdg/cerious-aasm/logs/cerious-aasm.log'],
      ['linux', {}, '/home/user/.config/cerious-aasm/logs/cerious-aasm.log']
    ])('falls back to the same folder on %s when Electron cannot say (%p)', (platform, env, expected) => {
      Object.defineProperty(process, 'platform', { value: platform });
      delete process.env.APPDATA;
      delete process.env.XDG_CONFIG_HOME;
      Object.assign(process.env, env);
      getPath.mockImplementation(() => { throw new Error('app not ready'); });

      expect(resolvePath()).toBe(expected);
    });
  });
});
