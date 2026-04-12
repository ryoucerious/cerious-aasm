import { jest } from '@jest/globals';

// ---- Mocks ----
jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    const proc: any = {
      pid: 12345,
      killed: false,
      exitCode: null,
      on: jest.fn(),
      once: jest.fn(),
      kill: jest.fn(),
    };
    return proc;
  }),
  execSync: jest.fn(),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs') as any;
  return {
    ...actual,
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    openSync: jest.fn(() => 3),
    existsSync: jest.fn(() => true),
  };
});

jest.mock('../../utils/validation.utils', () => ({
  validateInstanceId: jest.fn((id: string) => !!id && /^[a-zA-Z0-9_-]+$/.test(id)),
}));

jest.mock('../../utils/ark.utils', () => ({
  ArkPathUtils: {
    getArkServerDir: jest.fn(() => '/mock/ark'),
    getArkExecutablePath: jest.fn(() => '/mock/ark/ArkServer.exe'),
  },
  buildArkServerArgs: jest.fn(() => ['arg1', 'arg2']),
  ARK_APP_ID: '2430930',
}));

jest.mock('../../utils/ark/ark-server/ark-server-logging.utils', () => ({
  snapshotLogFiles: jest.fn(() => []),
  detectAndRegisterLogFile: jest.fn(),
  unregisterLogFile: jest.fn(),
}));

jest.mock('../../utils/ark/instance.utils', () => ({
  getInstancesBaseDir: jest.fn(() => '/mock/instances'),
  getInstance: jest.fn(() => ({ rconPort: 27020, rconPassword: 'test' })),
}));

jest.mock('../../utils/ark/ark-server/ark-server-state.utils', () => ({
  setInstanceState: jest.fn(),
  getInstanceState: jest.fn(() => 'stopped'),
  getNormalizedInstanceState: jest.fn(() => 'stopped'),
}));

jest.mock('../../utils/ark/ark-server/ark-server-paths.utils', () => ({
  prepareArkServerCommand: jest.fn(() => ({
    command: '/mock/ark/ArkServer.exe',
    args: ['arg1'],
    env: {},
  })),
}));

jest.mock('../../utils/platform.utils', () => ({
  getPlatform: jest.fn(() => 'windows'),
}));

jest.mock('../discord.service', () => ({
  discordService: {
    sendNotification: jest.fn(),
  },
}));

jest.mock('../rcon.service', () => ({
  rconService: {
    connectRcon: jest.fn(() => Promise.resolve()),
    disconnectRcon: jest.fn(() => Promise.resolve()),
    executeRconCommand: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../messaging.service', () => ({
  messagingService: {
    sendToAll: jest.fn(),
    sendToAllRenderers: jest.fn(),
  },
}));

jest.mock('./server-monitoring.service', () => ({
  serverMonitoringService: {
    setupLogMonitoring: jest.fn(),
  },
}));

import { spawn } from 'child_process';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('ServerProcessService', () => {
  let ServerProcessService: any;
  let service: any;

  beforeAll(() => {
    const mod = require('./server-process.service');
    ServerProcessService = mod.ServerProcessService;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    service = new ServerProcessService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('state management', () => {
    it('should delegate setInstanceState', () => {
      service.setInstanceState('inst1', 'running');

      const stateUtils = require('../../utils/ark/ark-server/ark-server-state.utils');
      expect(stateUtils.setInstanceState).toHaveBeenCalledWith('inst1', 'running');
    });

    it('should delegate getInstanceState', () => {
      const stateUtils = require('../../utils/ark/ark-server/ark-server-state.utils');
      (stateUtils.getInstanceState as jest.Mock).mockReturnValue('running');

      const state = service.getInstanceState('inst1');

      expect(state).toBe('running');
    });

    it('should delegate getNormalizedInstanceState', () => {
      const stateUtils = require('../../utils/ark/ark-server/ark-server-state.utils');
      (stateUtils.getNormalizedInstanceState as jest.Mock).mockReturnValue('stopped');

      const state = service.getNormalizedInstanceState('inst1');

      expect(state).toBe('stopped');
    });
  });

  describe('getServerProcess', () => {
    it('should return null when no process tracked', () => {
      expect(service.getServerProcess('unknown')).toBeNull();
    });
  });

  describe('getActiveProcessCount', () => {
    it('should return 0 initially', () => {
      expect(service.getActiveProcessCount()).toBe(0);
    });
  });

  describe('startServerProcess', () => {
    it('should spawn a server process successfully', async () => {
      const instance = { sessionName: 'TestServer', map: 'TheIsland_WP' };

      const result = await service.startServerProcess('inst1', instance);

      expect(result.success).toBe(true);
      expect(result.instanceId).toBe('inst1');
      expect(mockSpawn).toHaveBeenCalled();
    });

    it('should store process reference after spawn', async () => {
      const instance = { sessionName: 'TestServer' };

      await service.startServerProcess('inst1', instance);

      expect(service.getServerProcess('inst1')).toBeDefined();
      expect(service.getActiveProcessCount()).toBe(1);
    });

    it('should set instance state to starting', async () => {
      const instance = { sessionName: 'TestServer' };

      await service.startServerProcess('inst1', instance);

      const stateUtils = require('../../utils/ark/ark-server/ark-server-state.utils');
      expect(stateUtils.setInstanceState).toHaveBeenCalledWith('inst1', 'starting');
    });

    it('should write steam_appid.txt', async () => {
      const instance = { sessionName: 'TestServer' };

      await service.startServerProcess('inst1', instance);

      const fs = require('fs');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('steam_appid.txt'),
        '2430930',
        'utf8'
      );
    });

    it('should notify discord of server start', async () => {
      const instance = { sessionName: 'TestServer' };

      await service.startServerProcess('inst1', instance);

      const { discordService } = require('../discord.service');
      expect(discordService.sendNotification).toHaveBeenCalledWith(
        'inst1',
        'start',
        expect.any(String)
      );
    });

    it('should snapshot and register log files', async () => {
      const instance = { sessionName: 'TestServer' };

      await service.startServerProcess('inst1', instance);

      const logUtils = require('../../utils/ark/ark-server/ark-server-logging.utils');
      expect(logUtils.snapshotLogFiles).toHaveBeenCalled();
      expect(logUtils.detectAndRegisterLogFile).toHaveBeenCalledWith(
        'inst1', 'TestServer', expect.anything()
      );
    });
  });

  describe('setupProcessMonitoring', () => {
    it('should do nothing when no process exists', () => {
      // Should not throw
      service.setupProcessMonitoring('unknown', {});
    });

    it('should register event handlers on the process', async () => {
      const instance = { sessionName: 'TestServer' };
      await service.startServerProcess('inst1', instance);

      const proc = service.getServerProcess('inst1');
      service.setupProcessMonitoring('inst1', instance);

      // Should register exit and error handlers
      expect(proc.on).toHaveBeenCalledWith('exit', expect.any(Function));
      expect(proc.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should register once handlers for cleanup', async () => {
      const instance = { sessionName: 'TestServer' };
      await service.startServerProcess('inst1', instance);

      const proc = service.getServerProcess('inst1');
      service.setupProcessMonitoring('inst1', instance);

      // Once handlers clean up the safety net timer
      expect(proc.once).toHaveBeenCalledWith('exit', expect.any(Function));
      expect(proc.once).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('stopServerProcess', () => {
    it('should reject invalid instance ID', async () => {
      const result = await service.stopServerProcess('');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');
    });

    it('should succeed for already-stopped server', async () => {
      const stateUtils = require('../../utils/ark/ark-server/ark-server-state.utils');
      (stateUtils.getInstanceState as jest.Mock).mockReturnValue('stopped');

      const result = await service.stopServerProcess('inst1');

      expect(result.success).toBe(true);
    });

    it('should error when process not found and state is not stopped', async () => {
      const stateUtils = require('../../utils/ark/ark-server/ark-server-state.utils');
      (stateUtils.getInstanceState as jest.Mock).mockReturnValue('running');

      const result = await service.stopServerProcess('inst1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('cleanupOrphanedProcesses', () => {
    it('should kill tracked processes', async () => {
      const instance = { sessionName: 'TestServer' };
      await service.startServerProcess('inst1', instance);

      const proc = service.getServerProcess('inst1');
      service.cleanupOrphanedProcesses();

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should not throw when no processes are tracked', () => {
      expect(() => service.cleanupOrphanedProcesses()).not.toThrow();
    });

    it('should perform linux-specific cleanup on linux', async () => {
      const platformUtils = require('../../utils/platform.utils');
      (platformUtils.getPlatform as jest.Mock).mockReturnValue('linux');
      const { execSync } = require('child_process');

      service.cleanupOrphanedProcesses();

      expect(execSync).toHaveBeenCalled();
    });
  });
});
