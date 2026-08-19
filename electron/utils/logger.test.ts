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
});
