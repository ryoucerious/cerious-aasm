// Settings → Server Defaults → Server Ports, against real files: the ranges saved to the global
// config are the ones new servers take their ports from and edits are checked against, and the
// servers' own config.json files are what "taken" means.
jest.unmock('fs');
jest.unmock('fs-extra');
jest.unmock('path');
jest.unmock('crypto');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-ports-'));

jest.mock('../utils/platform.utils', () => ({
  ...jest.requireActual('../utils/platform.utils'),
  getDefaultInstallDir: () => mockRoot,
  getPlatform: () => 'linux',
  isRunningInDocker: () => false,
  getProcessMemoryUsage: jest.fn(async () => null)
}));
jest.mock('./ark-config.service', () => ({ arkConfigService: {} }));
jest.mock('./backup/backup.service', () => ({ backupService: {} }));
jest.mock('./clusters/cluster-import', () => ({ carryClusterData: jest.fn() }));
jest.mock('./discord.service', () => ({ validateDiscordConfig: jest.fn(() => null) }));
jest.mock('./scheduler.service', () => ({ schedulerService: { initSchedule: jest.fn(async () => undefined) } }));
jest.mock('./whitelist.service', () => ({ whitelistService: {} }));
jest.mock('./server-instance/server-monitoring.service', () => ({ serverMonitoringService: {} }));
jest.mock('./server-instance/server-process.service', () => ({
  serverProcessService: { getNormalizedInstanceState: jest.fn(() => 'stopped'), getServerProcess: jest.fn(() => null) }
}));

import { serverPortsService } from './server-ports.service';
import { serverManagementService } from './server-instance/server-management.service';
import { getInstance } from '../utils/ark/instance.utils';

/** Adds a server as the Add Server dialog does: with the default ports, whatever is taken. */
async function addServer(name: string) {
  return serverManagementService.saveInstance({ name, mapName: 'TheIsland_WP', gamePort: 7777, queryPort: 27015, rconPort: 27020 } as never);
}

const portsOf = (id: string) => {
  const saved = getInstance(id)!;
  return { gamePort: saved.gamePort, queryPort: saved.queryPort, rconPort: saved.rconPort };
};

describe('server ports, end to end', () => {
  afterAll(() => fs.rmSync(mockRoot, { recursive: true, force: true }));

  beforeEach(() => {
    fs.rmSync(mockRoot, { recursive: true, force: true });
    fs.mkdirSync(mockRoot, { recursive: true });
  });

  it('saves the ranges where the next server reads them, and packs new servers into them', async () => {
    const set = await serverPortsService.setRanges({
      game: { start: 7800, end: 7805 }, query: { start: 27100, end: 27102 }, rcon: { start: 27200, end: 27202 }
    });
    expect(set.success).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(mockRoot, 'global-config.json'), 'utf8')).serverPorts.game).toEqual({ start: 7800, end: 7805 });

    const first = await addServer('Island');
    const second = await addServer('Ragnarok');

    expect(first.success && portsOf(first.instance!.id)).toEqual({ gamePort: 7800, queryPort: 27100, rconPort: 27200 });
    // The peer port is the game port + 1, so the next game port is two up.
    expect(second.success && portsOf(second.instance!.id)).toEqual({ gamePort: 7802, queryPort: 27101, rconPort: 27201 });
  });

  it('refuses a new server once the ranges are full, saying where to widen them', async () => {
    await serverPortsService.setRanges({ game: { start: 7800, end: 7803 }, query: { start: 27100, end: 27101 }, rcon: { start: 27200, end: 27201 } });
    expect((await addServer('One')).success).toBe(true);
    expect((await addServer('Two')).success).toBe(true);

    const third = await addServer('Three');

    expect(third).toEqual({ success: false, error: expect.stringContaining('Widen them in Settings → Server Defaults → Server Ports') });
    expect(fs.readdirSync(path.join(mockRoot, 'AASMServer', 'ShooterGame', 'Saved', 'Servers'))).toHaveLength(2);
  });

  it('refuses an edit that moves a port outside the ranges, and takes one inside them', async () => {
    await serverPortsService.setRanges({ game: { start: 7800, end: 7810 }, query: { start: 27100, end: 27110 }, rcon: { start: 27200, end: 27210 } });
    const { instance } = await addServer('Island');
    const stored = getInstance(instance!.id)!;

    const outside = await serverManagementService.saveInstance({ ...stored, queryPort: 27500 });
    const peerOutside = await serverManagementService.saveInstance({ ...stored, gamePort: 7810 });
    const inside = await serverManagementService.saveInstance({ ...stored, queryPort: 27105 });

    expect(outside).toEqual({ success: false, error: expect.stringContaining('The query port 27500 is outside this machine\'s query ports (27100–27110)') });
    expect(peerOutside).toEqual({ success: false, error: expect.stringContaining('peer port 7811, always the game port + 1,') });
    expect(inside.success).toBe(true);
    expect(portsOf(instance!.id).queryPort).toBe(27105);
  });

  it('lets a server keep ports from before the ranges narrowed, and lists it as outside them', async () => {
    const { instance } = await addServer('Island');
    expect(portsOf(instance!.id).gamePort).toBe(7777);

    const narrowed = await serverPortsService.setRanges({ game: { start: 7800, end: 7810 }, query: { start: 27100, end: 27110 }, rcon: { start: 27200, end: 27210 } });
    const renamed = await serverManagementService.saveInstance({ ...getInstance(instance!.id)!, name: 'The Island' });

    expect(renamed.success).toBe(true);
    expect(portsOf(instance!.id).gamePort).toBe(7777);
    expect(narrowed.success && narrowed.state.outside.map(server => [server.name, server.ports.map(port => port.label)]))
      .toEqual([['Island', ['Game', 'Peer', 'Query', 'RCON']]]);
  });
});
