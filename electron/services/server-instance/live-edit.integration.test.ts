// Settings saved while a server runs, against real files: a start keeps what the server started
// with, an edit saves beside it without touching it, RCON keeps the password and port the running
// server knows, and the next start takes the new settings.
jest.unmock('fs');
jest.unmock('fs-extra');
jest.unmock('path');
jest.unmock('crypto');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-live-edit-'));

jest.mock('../../utils/platform.utils', () => ({
  ...jest.requireActual('../../utils/platform.utils'),
  getDefaultInstallDir: () => mockRoot,
  getPlatform: () => 'linux',
  isRunningInDocker: () => false,
  getProcessMemoryUsage: jest.fn(async () => null)
}));
// The ARK files themselves: nothing here to link or write them into.
jest.mock('../../utils/ark/ark-server/ark-server-isolation.utils', () => ({
  isInstanceOwnedWin64File: jest.fn(() => false),
  linkInstanceSaveDir: jest.fn(async () => false),
  linkSharedShooterGameSubdirs: jest.fn(),
  linkSharedWin64Subdirs: jest.fn()
}));
jest.mock('../ark-config.service', () => ({ arkConfigService: { writeArkConfigFiles: jest.fn() } }));
jest.mock('../backup/backup.service', () => ({ backupService: {} }));
jest.mock('../clusters/cluster-import', () => ({ carryClusterData: jest.fn() }));
jest.mock('../discord.service', () => ({ validateDiscordConfig: jest.fn(() => null) }));
jest.mock('../scheduler.service', () => ({ schedulerService: { initSchedule: jest.fn(async () => undefined) } }));
jest.mock('../whitelist.service', () => ({ whitelistService: {} }));
jest.mock('./server-monitoring.service', () => ({ serverMonitoringService: {} }));
jest.mock('./server-process.service', () => ({
  serverProcessService: { getNormalizedInstanceState: jest.fn(() => 'running'), getServerProcess: jest.fn(() => null) }
}));
// The RCON connection itself: what it would connect with is what is checked.
jest.mock('../../utils/rcon.utils', () => ({
  ...jest.requireActual('../../utils/rcon.utils'),
  connectRcon: jest.fn((_id: string, _instance: unknown, done: (connected: boolean) => void) => done(true)),
  isRconConnected: jest.fn(() => false)
}));

import { serverManagementService } from './server-management.service';
import { rconService } from '../rcon.service';
import { connectRcon } from '../../utils/rcon.utils';
import { getInstance } from '../../utils/ark/instance.utils';
import { readStartedConfig } from '../../utils/ark/started-config.utils';
import type { InstanceConfig } from '../../types/server-instance.types';

describe('editing a running server', () => {
  afterAll(() => fs.rmSync(mockRoot, { recursive: true, force: true }));

  beforeEach(() => {
    fs.rmSync(mockRoot, { recursive: true, force: true });
    fs.mkdirSync(mockRoot, { recursive: true });
  });

  async function startedServer(): Promise<InstanceConfig> {
    const saved = await serverManagementService.saveInstance({
      name: 'Island', mapName: 'TheIsland_WP', gamePort: 7777, queryPort: 27015, rconPort: 27020, rconPassword: 'first-pass', maxPlayers: 70
    } as never);
    const instance = getInstance(saved.instance!.id)!;
    await serverManagementService.prepareInstanceConfiguration(instance.id, instance);
    return instance;
  }

  it('keeps what the server started with while new settings are saved beside it', async () => {
    const started = await startedServer();

    const edit = await serverManagementService.saveInstance({ ...started, maxPlayers: 50, rconPassword: 'second-pass', rconPort: 27021 });

    expect(edit.success).toBe(true);
    expect(getInstance(started.id)).toMatchObject({ maxPlayers: 50, rconPassword: 'second-pass', rconPort: 27021 });
    expect(readStartedConfig(started.id)).toMatchObject({ maxPlayers: 70, rconPassword: 'first-pass', rconPort: 27020 });
    expect(fs.existsSync(path.join(mockRoot, 'AASMServer', 'ShooterGame', 'Saved', 'Servers', started.id, 'started-config.json'))).toBe(true);
  });

  it('connects RCON with the password and port the running server knows, until it starts again', async () => {
    const started = await startedServer();
    await serverManagementService.saveInstance({ ...started, rconPassword: 'second-pass', rconPort: 27021 });

    await rconService.connectRcon(started.id);
    expect(jest.mocked(connectRcon).mock.calls.at(-1)![1]).toMatchObject({ rconPassword: 'first-pass', rconPort: 27020 });

    // The restart: the next start records the settings as they are now.
    await serverManagementService.prepareInstanceConfiguration(started.id, getInstance(started.id)!);
    await rconService.connectRcon(started.id);
    expect(jest.mocked(connectRcon).mock.calls.at(-1)![1]).toMatchObject({ rconPassword: 'second-pass', rconPort: 27021 });
  });

  it('has nothing to compare against for a server that has not started since', async () => {
    const saved = await serverManagementService.saveInstance({ name: 'Ragnarok', mapName: 'Ragnarok_WP', gamePort: 7779, queryPort: 27016, rconPort: 27022 } as never);

    expect(readStartedConfig(saved.instance!.id)).toBeNull();
  });
});
