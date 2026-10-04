import { EventEmitter } from 'events';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execFile: jest.fn((_file: string, _args: string[], _options: object, callback: (error: Error | null) => void) => callback(null))
}));
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  openSync: jest.fn(() => 3),
  closeSync: jest.fn()
}));
jest.mock('../../utils/ark/instance.utils', () => ({
  getInstanceDir: jest.fn((id: string) => `/instances/${id}`),
  getInstance: jest.fn((id: string) => ({ id, name: 'Alpha', rconPort: 27020, rconPassword: 'pw' }))
}));
jest.mock('../../utils/ark/ark-args.utils', () => ({ buildArkServerArgs: jest.fn(() => ['TheIsland_WP?listen']) }));
jest.mock('../../utils/ark/ark-server/ark-server-paths.utils', () => ({
  ARK_APP_ID: '2430930',
  resolveServerLaunch: jest.fn(() => ({
    executable: '/instances/inst1/ShooterGame/Binaries/Win64/ArkAscendedServer.exe',
    cwd: '/instances/inst1/ShooterGame/Binaries/Win64',
    usesAsaApiLoader: false
  })),
  prepareArkServerCommand: jest.fn((executable: string, args: string[]) => ({ command: executable, args })),
  getInstanceAltSaveDirName: jest.fn(() => 'SavedArks'),
  getInstanceLogsDir: jest.fn(() => '/instances/inst1/ShooterGame/Saved/Logs')
}));
jest.mock('../../utils/ark/ark-server/ark-server-logging.utils', () => ({
  snapshotLogFiles: jest.fn(() => new Map()),
  detectAndRegisterLogFile: jest.fn(),
  setupLogTailing: jest.fn(),
  unregisterLogFile: jest.fn(),
  readLogTail: jest.fn(() => [])
}));
jest.mock('../../utils/ark/ark-server/ark-server-cleanup.utils', () => ({
  killInstanceProcesses: jest.fn(),
  cleanupOrphanedArkProcesses: jest.fn(),
  holdStartsUntil: jest.fn(),
  rememberInstanceProcessMarker: jest.fn()
}));
jest.mock('../../utils/platform.utils', () => ({ getPlatform: jest.fn(() => 'windows') }));
jest.mock('../discord.service', () => ({ discordService: { sendNotification: jest.fn() } }));
jest.mock('../rcon.service', () => ({
  rconService: {
    connectRcon: jest.fn(),
    disconnectRcon: jest.fn(),
    forceDisconnectRcon: jest.fn(),
    executeRconCommand: jest.fn(),
    getRconStatus: jest.fn(),
    reconnectRcon: jest.fn()
  }
}));
jest.mock('../messaging.service', () => ({ messagingService: { sendToAll: jest.fn() } }));

import { spawn, execFile } from 'child_process';
import * as fs from 'fs';
import { ServerProcessService } from './server-process.service';
import { getInstanceState, setInstanceState } from '../../utils/ark/ark-server/ark-server-state.utils';
import { prepareArkServerCommand, resolveServerLaunch } from '../../utils/ark/ark-server/ark-server-paths.utils';
import {
  detectAndRegisterLogFile,
  readLogTail,
  setupLogTailing,
  snapshotLogFiles,
  unregisterLogFile
} from '../../utils/ark/ark-server/ark-server-logging.utils';
import {
  cleanupOrphanedArkProcesses,
  holdStartsUntil,
  killInstanceProcesses,
  rememberInstanceProcessMarker
} from '../../utils/ark/ark-server/ark-server-cleanup.utils';
import { getPlatform } from '../../utils/platform.utils';
import { discordService } from '../discord.service';
import { rconService } from '../rcon.service';
import { messagingService } from '../messaging.service';

class FakeChild extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  kill = jest.fn(() => true);

  constructor(pid: number | undefined) {
    super();
    this.pid = pid;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

const mockSpawn = spawn as unknown as jest.Mock;
const mockRcon = jest.mocked(rconService);
const mockMessaging = jest.mocked(messagingService);
let nextPid = 4242;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function broadcasts(channel: string): unknown[] {
  return mockMessaging.sendToAll.mock.calls.filter(([sent]) => sent === channel).map(([, data]) => data);
}

describe('ServerProcessService', () => {
  let service: ServerProcessService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new ServerProcessService();
    setInstanceState('inst1', 'stopped');
    mockSpawn.mockImplementation(() => new FakeChild(nextPid++));
    mockRcon.connectRcon.mockResolvedValue({ success: true, connected: true, instanceId: 'inst1' });
    mockRcon.disconnectRcon.mockResolvedValue({ success: true, connected: false, instanceId: 'inst1' });
    mockRcon.forceDisconnectRcon.mockResolvedValue(undefined);
    mockRcon.executeRconCommand.mockResolvedValue({ success: true, response: '', instanceId: 'inst1' });
    mockRcon.getRconStatus.mockReturnValue({ success: true, connected: false, instanceId: 'inst1' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Spawns and monitors inst1 the way the lifecycle service does; returns its child. */
  async function start(onState = jest.fn(), onLog = jest.fn()): Promise<FakeChild> {
    await service.startServerProcess('inst1', { id: 'inst1', name: 'Alpha' });
    const child = mockSpawn.mock.results[mockSpawn.mock.results.length - 1].value as FakeChild;
    service.setupProcessMonitoring('inst1', onLog, onState);
    return child;
  }

  function useAsaApiLoader(): void {
    jest.mocked(resolveServerLaunch).mockReturnValueOnce({
      executable: '/instances/inst1/ShooterGame/Binaries/Win64/AsaApiLoader.exe',
      cwd: '/instances/inst1/ShooterGame/Binaries/Win64',
      usesAsaApiLoader: true
    });
  }

  /** What log tailing reports when it sees the advertising line. */
  function reportRunning(): void {
    const calls = (setupLogTailing as jest.Mock).mock.calls;
    const handleState = calls[calls.length - 1][2];
    setInstanceState('inst1', 'running');
    handleState('running');
  }

  describe('startServerProcess', () => {
    it('spawns the server, tracks it and marks it starting', async () => {
      const child = await start();

      expect(mockSpawn).toHaveBeenCalledWith(
        '/instances/inst1/ShooterGame/Binaries/Win64/ArkAscendedServer.exe',
        ['TheIsland_WP?listen'],
        expect.objectContaining({ cwd: '/instances/inst1/ShooterGame/Binaries/Win64', windowsHide: true, detached: false })
      );
      expect(service.getServerProcess('inst1')).toBe(child);
      expect(service.getActiveProcessCount()).toBe(1);
      expect(service.hasActiveProcess('inst1')).toBe(true);
      expect(getInstanceState('inst1')).toBe('starting');
    });

    // Whether the instance runs isolated, and so the marker, can change before the sweep runs.
    it('records the marker its processes carry just before spawning', async () => {
      await start();

      expect(rememberInstanceProcessMarker).toHaveBeenCalledWith('inst1');
      expect(jest.mocked(rememberInstanceProcessMarker).mock.invocationCallOrder[0])
        .toBeLessThan(mockSpawn.mock.invocationCallOrder[0]);
    });

    it('detaches the server on Linux so it leads its own process group', async () => {
      jest.mocked(getPlatform).mockReturnValueOnce('linux').mockReturnValue('linux');
      await start();
      jest.mocked(getPlatform).mockReturnValue('windows');

      expect(mockSpawn.mock.calls[0][2].detached).toBe(true);
    });

    it('writes steam_appid.txt next to the executable', async () => {
      await start();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/instances/inst1/ShooterGame/Binaries/Win64/steam_appid.txt', '2430930', 'utf8'
      );
    });

    // Windows used to capture nothing, so a server that aborted before ShooterGame.log existed
    // reached the user only as "Could not detect log file".
    it('sends stderr to a per-instance file and releases the parent descriptor', async () => {
      await start();

      expect(fs.openSync).toHaveBeenCalledWith('/instances/inst1/stderr.log', 'w');
      expect(mockSpawn.mock.calls[0][2].stdio).toEqual(['ignore', 'ignore', 3]);
      expect(fs.closeSync).toHaveBeenCalledWith(3);
    });

    it('snapshots the logs before spawning and then looks for the new one', async () => {
      await start();

      expect(jest.mocked(snapshotLogFiles).mock.invocationCallOrder[0]).toBeLessThan(mockSpawn.mock.invocationCallOrder[0]);
      expect(detectAndRegisterLogFile).toHaveBeenCalledWith('inst1', expect.any(Map));
    });

    it('announces the start on Discord', async () => {
      await start();

      expect(discordService.sendNotification).toHaveBeenCalledWith('inst1', 'start', 'Server is starting up...');
    });

    it('launches through AsaApiLoader when the instance has it', async () => {
      jest.mocked(resolveServerLaunch).mockReturnValueOnce({
        executable: '/instances/inst1/ShooterGame/Binaries/Win64/AsaApiLoader.exe',
        cwd: '/instances/inst1/ShooterGame/Binaries/Win64',
        usesAsaApiLoader: true
      });

      await start();

      expect(prepareArkServerCommand).toHaveBeenCalledWith(
        '/instances/inst1/ShooterGame/Binaries/Win64/AsaApiLoader.exe', ['TheIsland_WP?listen'], 'inst1'
      );
    });
  });

  describe('when the server comes up', () => {
    it('tails the log with the caller\'s callbacks', async () => {
      const onState = jest.fn();
      const onLog = jest.fn();
      await start(onState, onLog);

      const [instanceId, tailOnLog] = (setupLogTailing as jest.Mock).mock.calls[0];
      tailOnLog('line');
      expect(instanceId).toBe('inst1');
      expect(onLog).toHaveBeenCalledWith('line');
    });

    // The only rcon-status {connected: true} used to come from a second, parallel connect that
    // never answered while this loop was running, so slow Proton boots never showed as connected.
    it('connects RCON once and tells every client the result', async () => {
      const onState = jest.fn();
      await start(onState);

      reportRunning();
      await flush();

      expect(onState).toHaveBeenCalledWith('running');
      expect(mockRcon.connectRcon).toHaveBeenCalledTimes(1);
      expect(broadcasts('rcon-status')).toEqual([{ instanceId: 'inst1', connected: true }]);
    });

    it('does not connect RCON for a server that is already stopping, and reports its exit as a stop', async () => {
      const child = await start();
      setInstanceState('inst1', 'stopping');
      const calls = (setupLogTailing as jest.Mock).mock.calls;

      calls[calls.length - 1][2]('running');
      await flush();
      child.exit(0);

      expect(mockRcon.connectRcon).not.toHaveBeenCalled();
      expect(getInstanceState('inst1')).toBe('stopped');
    });

    it('still tries RCON after 15 minutes when the startup line is never seen', async () => {
      const onState = jest.fn();
      await start(onState);

      jest.advanceTimersByTime(15 * 60 * 1000);
      await flush();

      expect(getInstanceState('inst1')).toBe('running');
      expect(onState).toHaveBeenCalledWith('running');
      expect(mockRcon.connectRcon).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the process exits', () => {
    it('reports a server that was running as crashed', async () => {
      const onState = jest.fn();
      const child = await start(onState);
      reportRunning();

      child.exit(0);

      expect(getInstanceState('inst1')).toBe('crashed');
      expect(onState).toHaveBeenLastCalledWith('crashed');
      expect(discordService.sendNotification).toHaveBeenCalledWith('inst1', 'crash', 'Server crashed (exit code 0)');
      expect(service.getServerProcess('inst1')).toBeNull();
    });

    it('reports a server that died during startup as crashed, with the stderr tail', async () => {
      jest.mocked(readLogTail).mockReturnValueOnce(['wine: could not load kernel32.dll']);
      const child = await start();

      child.exit(null, 'SIGSEGV');

      expect(getInstanceState('inst1')).toBe('crashed');
      expect(readLogTail).toHaveBeenCalledWith('/instances/inst1/stderr.log', 50);
      expect(broadcasts('notification')).toEqual([
        { type: 'error', message: 'Alpha crashed during startup (signal SIGSEGV). Check the logs for details.' }
      ]);
      expect(broadcasts('server-instance-log')).toEqual([{
        instanceId: 'inst1',
        log: expect.stringContaining('wine: could not load kernel32.dll')
      }]);
      expect(discordService.sendNotification).toHaveBeenCalledWith('inst1', 'crash', 'Server crashed during startup (signal SIGSEGV)');
    });

    it('reports a server that was being stopped as stopped', async () => {
      const onState = jest.fn();
      const child = await start(onState);
      setInstanceState('inst1', 'stopping');

      child.exit(0);

      expect(getInstanceState('inst1')).toBe('stopped');
      expect(onState).toHaveBeenLastCalledWith('stopped');
      expect(discordService.sendNotification).toHaveBeenCalledWith('inst1', 'stop', 'Server has stopped');
    });

    // Log lines are read every few seconds; the shutdown line of a server stopped in game may
    // still be unread when the process goes.
    it('reads the rest of the log before deciding between stopped and crashed', async () => {
      const child = await start();
      reportRunning();
      jest.mocked(unregisterLogFile).mockImplementationOnce(() => setInstanceState('inst1', 'stopping'));

      child.exit(0);

      expect(getInstanceState('inst1')).toBe('stopped');
    });

    it('frees the instance\'s ports and disconnects RCON', async () => {
      useAsaApiLoader();
      const child = await start();

      child.exit(1);
      await flush();

      expect(killInstanceProcesses).toHaveBeenCalledWith('inst1');
      expect(mockRcon.disconnectRcon).toHaveBeenCalledWith('inst1');
      expect(broadcasts('rcon-status')).toEqual([{ instanceId: 'inst1', connected: false }]);
      expect(jest.getTimerCount()).toBe(0);
    });

    // After a force kill and a quick restart, the old process's exit used to untrack, and then
    // kill, the new one.
    // ArkAscendedServer.exe itself was the tracked process, so nothing can outlive it.
    it('skips the leftover sweep on Windows when the server was launched directly', async () => {
      const child = await start();

      child.exit(1);

      expect(killInstanceProcesses).not.toHaveBeenCalled();
    });

    it('sweeps for leftovers under Proton, where the tracked process is only the launcher', async () => {
      jest.mocked(getPlatform).mockReturnValue('linux');
      const child = await start();
      jest.mocked(getPlatform).mockReturnValue('windows');

      child.exit(1);

      expect(killInstanceProcesses).toHaveBeenCalledWith('inst1');
    });

    it('ignores the exit of a process that was force-killed and replaced', async () => {
      const oldChild = await start();
      await service.forceKillServerProcess('inst1');
      const onState = jest.fn();
      const newChild = await start(onState);
      jest.mocked(killInstanceProcesses).mockClear();

      oldChild.exit(null, 'SIGKILL');

      expect(service.getServerProcess('inst1')).toBe(newChild);
      expect(getInstanceState('inst1')).toBe('starting');
      expect(onState).not.toHaveBeenCalled();
      expect(killInstanceProcesses).not.toHaveBeenCalled();
    });

    it('clears tracking when the executable could not be spawned', async () => {
      mockSpawn.mockImplementationOnce(() => new FakeChild(undefined));
      const onState = jest.fn();
      const child = await start(onState);

      child.emit('error', Object.assign(new Error('spawn xvfb-run ENOENT'), { code: 'ENOENT' }));

      expect(service.getServerProcess('inst1')).toBeNull();
      expect(getInstanceState('inst1')).toBe('error');
      expect(onState).toHaveBeenCalledWith('error');
    });

    it('keeps tracking a running process whose kill failed', async () => {
      const child = await start();

      child.emit('error', new Error('kill EPERM'));

      expect(service.getServerProcess('inst1')).toBe(child);
      expect(getInstanceState('inst1')).toBe('starting');
    });
  });

  describe('forceKillServerProcess', () => {
    it('kills the process tree on Windows, frees the ports and reports stopped', async () => {
      useAsaApiLoader();
      const onState = jest.fn();
      const child = await start(onState);

      await service.forceKillServerProcess('inst1');

      expect(execFile).toHaveBeenCalledWith('taskkill', ['/F', '/T', '/PID', String(child.pid)], expect.objectContaining({ windowsHide: true }), expect.any(Function));
      expect(mockRcon.forceDisconnectRcon).toHaveBeenCalledWith('inst1');
      expect(unregisterLogFile).toHaveBeenCalledWith('inst1');
      expect(killInstanceProcesses).toHaveBeenCalledWith('inst1');
      expect(service.getServerProcess('inst1')).toBeNull();
      expect(getInstanceState('inst1')).toBe('stopped');
      expect(onState.mock.calls).toEqual([['stopped']]);
      expect(broadcasts('rcon-status')).toEqual([{ instanceId: 'inst1', connected: false }]);
    });

    it('broadcasts stopped itself for a server started without a state callback', async () => {
      await service.startServerProcess('inst1', { id: 'inst1', name: 'Alpha' });
      service.setupProcessMonitoring('inst1');

      await service.forceKillServerProcess('inst1');

      expect(broadcasts('server-instance-state')).toEqual([{ state: 'stopped', instanceId: 'inst1' }]);
      expect(broadcasts('rcon-status')).toEqual([{ instanceId: 'inst1', connected: false }]);
    });

    it('returns only once the leftover sweep has finished', async () => {
      useAsaApiLoader();
      await start();
      let finishSweep: () => void = () => undefined;
      jest.mocked(killInstanceProcesses).mockReturnValueOnce(new Promise<void>(resolve => { finishSweep = resolve; }));
      const done = jest.fn();

      const killing = service.forceKillServerProcess('inst1').then(done);
      await flush();
      expect(killInstanceProcesses).toHaveBeenCalledWith('inst1');
      expect(done).not.toHaveBeenCalled();

      finishSweep();
      await killing;
      expect(getInstanceState('inst1')).toBe('stopped');
    });

    // A start arriving during taskkill used to spawn, then have its log tailer torn down and its
    // state set back to stopped when the kill finished.
    it('makes a start that arrives meanwhile wait for the whole kill', async () => {
      useAsaApiLoader();
      await start();
      let finishTaskkill: (error: Error | null) => void = () => undefined;
      jest.mocked(execFile).mockImplementationOnce(((_file: string, _args: string[], _options: object, callback: (error: Error | null) => void) => {
        finishTaskkill = callback;
      }) as never);
      const stateWhenReleased = jest.fn();

      const killing = service.forceKillServerProcess('inst1');
      await flush();
      expect(holdStartsUntil).toHaveBeenCalledWith('inst1', expect.any(Promise));
      const teardown = jest.mocked(holdStartsUntil).mock.calls[0][1];
      void teardown.then(() => stateWhenReleased(getInstanceState('inst1'), jest.mocked(unregisterLogFile).mock.calls.length));
      await flush();
      expect(stateWhenReleased).not.toHaveBeenCalled();

      finishTaskkill(null);
      await killing;
      expect(stateWhenReleased).toHaveBeenCalledWith('stopped', 1);
    });

    it('skips the sweep after killing a directly launched server on Windows', async () => {
      await start();

      await service.forceKillServerProcess('inst1');

      expect(killInstanceProcesses).not.toHaveBeenCalled();
    });

    it('sweeps when it has no process to go by', async () => {
      setInstanceState('inst1', 'stopping');

      await service.forceKillServerProcess('inst1');

      expect(killInstanceProcesses).toHaveBeenCalledWith('inst1');
    });

    it('kills the whole process group on Linux', async () => {
      const child = await start();
      jest.mocked(getPlatform).mockReturnValue('linux');
      const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);

      await service.forceKillServerProcess('inst1');
      jest.mocked(getPlatform).mockReturnValue('windows');

      expect(kill).toHaveBeenCalledWith(-child.pid!, 'SIGKILL');
    });

    // Its exit is ignored once untracked, so the kill reports the stop itself: the state callback
    // is what ends the memory, CPU and player polls and shows the server as stopped.
    it('reports the stop through the state callback the server was started with', async () => {
      const onState = jest.fn();
      await start(onState);
      reportRunning();

      await service.forceKillServerProcess('inst1');

      expect(onState).toHaveBeenLastCalledWith('stopped');
      expect(broadcasts('rcon-status').pop()).toEqual({ instanceId: 'inst1', connected: false });
    });

    it('forgets the state callback of a server it has killed', async () => {
      const onState = jest.fn();
      await start(onState);
      await service.forceKillServerProcess('inst1');
      onState.mockClear();

      await service.forceKillServerProcess('inst1');

      expect(onState).not.toHaveBeenCalled();
      expect(broadcasts('server-instance-state')).toEqual([{ state: 'stopped', instanceId: 'inst1' }]);
    });

    it('can leave the broadcast to the caller', async () => {
      const onState = jest.fn();
      await start(onState);

      await service.forceKillServerProcess('inst1', { broadcast: false });

      expect(broadcasts('server-instance-state')).toEqual([]);
      expect(onState).not.toHaveBeenCalled();
    });
  });

  describe('stopServerProcess', () => {
    it('refuses an invalid id', async () => {
      await expect(service.stopServerProcess('../x')).resolves.toEqual({ success: false, error: 'Invalid instance ID', instanceId: '../x' });
    });

    it.each(['stopped', 'crashed', 'error'])('succeeds when the server is already %s', async state => {
      setInstanceState('inst1', state);
      await expect(service.stopServerProcess('inst1')).resolves.toEqual({ success: true, instanceId: 'inst1' });
    });

    it('fails when no process is tracked for a server that is not stopped', async () => {
      setInstanceState('inst1', 'running');
      await expect(service.stopServerProcess('inst1')).resolves.toMatchObject({ success: false, error: 'Server process not found' });
    });

    it('saves the world, asks the server to exit and waits for it', async () => {
      const child = await start();
      reportRunning();

      const stopping = service.stopServerProcess('inst1');
      await flush();
      expect(getInstanceState('inst1')).toBe('stopping');
      expect(mockRcon.executeRconCommand).toHaveBeenCalledWith('inst1', 'SaveWorld', 30000);
      jest.advanceTimersByTime(5000);
      await flush();
      expect(mockRcon.executeRconCommand).toHaveBeenLastCalledWith('inst1', 'DoExit', 15000);
      child.exit(0);

      await expect(stopping).resolves.toEqual({ success: true, instanceId: 'inst1' });
      expect(child.kill).not.toHaveBeenCalled();
      expect(getInstanceState('inst1')).toBe('stopped');
      expect(jest.getTimerCount()).toBe(0);
    });

    // A console DoExit that never went out must not undo the stopping mark a real stop relies on.
    it('says a stop is in progress until it has finished', async () => {
      const child = await start();
      reportRunning();
      expect(service.isStopInProgress('inst1')).toBe(false);

      const stopping = service.stopServerProcess('inst1');
      await flush();
      expect(service.isStopInProgress('inst1')).toBe(true);
      jest.advanceTimersByTime(5000);
      await flush();
      child.exit(0);
      await stopping;

      expect(service.isStopInProgress('inst1')).toBe(false);
    });

    it('does not count a stop with no process to stop', async () => {
      setInstanceState('inst1', 'stopped');

      await service.stopServerProcess('inst1');

      expect(service.isStopInProgress('inst1')).toBe(false);
    });

    // A SaveWorld that times out drops the connection; without a reconnect DoExit never reached
    // the server and every such stop waited the full two minutes.
    it('reconnects RCON for DoExit when SaveWorld timed out', async () => {
      const child = await start();
      reportRunning();
      mockRcon.getRconStatus.mockReturnValueOnce({ success: true, connected: true, instanceId: 'inst1' });
      mockRcon.executeRconCommand.mockResolvedValueOnce({ success: false, error: 'RCON command timed out after 30000ms', instanceId: 'inst1' });
      mockRcon.reconnectRcon.mockResolvedValue(true);

      const stopping = service.stopServerProcess('inst1');
      await flush();

      expect(mockRcon.reconnectRcon).toHaveBeenCalledWith('inst1', 5000);
      expect(mockRcon.executeRconCommand).toHaveBeenLastCalledWith('inst1', 'DoExit', 15000);
      expect(mockRcon.reconnectRcon.mock.invocationCallOrder[0])
        .toBeLessThan(mockRcon.executeRconCommand.mock.invocationCallOrder[1]);
      child.exit(0);
      await expect(stopping).resolves.toEqual({ success: true, instanceId: 'inst1' });
    });

    it('does not try to reconnect RCON that was never connected', async () => {
      const child = await start();
      mockRcon.executeRconCommand.mockResolvedValue({ success: false, error: 'RCON not connected for this instance', instanceId: 'inst1' });

      const stopping = service.stopServerProcess('inst1');
      await flush();
      child.exit(0);
      await stopping;

      expect(mockRcon.reconnectRcon).not.toHaveBeenCalled();
    });

    // Nothing will make a server exit that never got DoExit (no RCON yet while it starts, say), so
    // waiting two minutes for it only delayed the kill.
    it('terminates at once a server DoExit could not be sent to', async () => {
      const child = await start();
      mockRcon.executeRconCommand.mockResolvedValue({ success: false, error: 'RCON not connected for this instance', notSent: true, instanceId: 'inst1' });

      const stopping = service.stopServerProcess('inst1');
      await flush();
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      child.exit(null, 'SIGTERM');

      await expect(stopping).resolves.toEqual({ success: true, instanceId: 'inst1' });
      expect(execFile).not.toHaveBeenCalled();
      expect(getInstanceState('inst1')).toBe('stopped');
      expect(jest.getTimerCount()).toBe(0);
    });

    it('terminates, then force-kills, a server that ignores the request', async () => {
      const child = await start();
      mockRcon.executeRconCommand.mockResolvedValue({ success: false, error: 'RCON command timed out after 15000ms', instanceId: 'inst1' });

      const stopping = service.stopServerProcess('inst1');
      await flush();
      jest.advanceTimersByTime(120000);
      await flush();
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      jest.advanceTimersByTime(5000);
      await flush();

      await expect(stopping).resolves.toEqual({ success: true, instanceId: 'inst1' });
      expect(execFile).toHaveBeenCalledWith('taskkill', ['/F', '/T', '/PID', String(child.pid)], expect.anything(), expect.any(Function));
      child.exit(null, 'SIGKILL');
      expect(getInstanceState('inst1')).toBe('stopped');
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('killAllProcesses', () => {
    it('terminates every server without reporting crashes', async () => {
      const onState = jest.fn();
      const child = await start(onState);
      reportRunning();

      service.killAllProcesses();
      child.exit(null, 'SIGTERM');

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(service.getActiveProcessCount()).toBe(0);
      expect(onState).not.toHaveBeenCalledWith('crashed');
      expect(discordService.sendNotification).not.toHaveBeenCalledWith('inst1', 'crash', expect.anything());
    });

    it('also stops leftovers from this install on Linux', () => {
      jest.mocked(getPlatform).mockReturnValue('linux');
      service.killAllProcesses();
      jest.mocked(getPlatform).mockReturnValue('windows');

      expect(cleanupOrphanedArkProcesses).toHaveBeenCalled();
    });
  });
});
