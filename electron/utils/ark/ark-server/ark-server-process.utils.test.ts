// ark-server-process.utils.test.ts
// Unit tests for ARK server process management

jest.mock('fs');
jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/'))
}));
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));
jest.mock('../../platform.utils', () => ({
  getPlatform: jest.fn()
}));
jest.mock('../ark-args.utils', () => ({
  buildArkServerArgs: jest.fn()
}));
jest.mock('./ark-server-install.utils', () => ({
  getArkServerDir: jest.fn()
}));
jest.mock('./ark-server-paths.utils', () => ({
  getArkExecutablePath: jest.fn(),
  prepareArkServerCommand: jest.fn()
}));
jest.mock('./ark-server-state.utils', () => ({
  setInstanceState: jest.fn(),
  arkServerProcesses: {}
}));

import * as fs from "fs";

const processUtils = require('./ark-server-process.utils');
const { arkServerProcesses } = require('./ark-server-state.utils');
const { buildArkServerArgs } = require('../ark-args.utils');
const { spawn } = require('child_process');
const { setInstanceState } = require('./ark-server-state.utils');
const arkServerPaths = require('./ark-server-paths.utils');


describe('ark-server-process.utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(arkServerProcesses).forEach(k => delete arkServerProcesses[k]);
  });

  describe('spawnServerProcess', () => {
    it('throws if executable does not exist', () => {
      arkServerPaths.getArkExecutablePath.mockReturnValue('/ark.exe');
  jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(() => processUtils.spawnServerProcess('id', '/instance', {})).toThrow('Ark server not installed');
    });
  });

  describe('setupProcessEventHandlers', () => {
    it('handles stdout, stderr, close, and error events', () => {
      const onLog = jest.fn();
      const onState = jest.fn();
      const logTail = { close: jest.fn() };
      const proc = {
        stdout: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from('out')); }) },
        stderr: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from('err')); }) },
        on: jest.fn((event, cb) => {
          if (event === 'close') cb(0);
          if (event === 'error') cb(new Error('fail'));
        })
      };
      processUtils.setupProcessEventHandlers('id', proc, logTail, onLog, onState);
      expect(onLog).toHaveBeenCalledWith('[STDOUT] out');
      expect(onLog).toHaveBeenCalledWith('[STDERR] err');
      expect(onLog).toHaveBeenCalledWith('[PROCESS EXIT] Ark server exited with code 0');
      expect(onLog).toHaveBeenCalledWith('[ERROR] fail');
      expect(onState).toHaveBeenCalledWith('stopped');
      expect(onState).toHaveBeenCalledWith('error');
      expect(logTail.close).toHaveBeenCalledTimes(2);
      expect(setInstanceState).toHaveBeenCalledWith('id', 'stopped');
      expect(setInstanceState).toHaveBeenCalledWith('id', 'error');
      expect(arkServerProcesses['id']).toBeUndefined();
    });
  });
});
