import { ServerPortsService, type ServerPortsDeps } from './server-ports.service';
import { DEFAULT_SERVER_PORT_RANGES } from '../utils/ark/port-sets';
import type { GlobalConfig } from '../utils/global-config.utils';
import type { WindowsFirewallStatus } from './windows-firewall.service';

describe('ServerPortsService', () => {
  const open: WindowsFirewallStatus = { enabled: true, rules: 'open', blockedPrograms: [], portsOpen: true };
  const missing: WindowsFirewallStatus = { enabled: true, rules: 'missing', blockedPrograms: [], portsOpen: false };
  const custom = { game: { start: 7000, end: 7100 }, query: { start: 27000, end: 27010 }, rcon: { start: 27100, end: 27110 } };
  let config: GlobalConfig;
  let now: number;
  let deps: jest.Mocked<ServerPortsDeps>;

  function service(overrides: Partial<ServerPortsDeps> = {}): ServerPortsService {
    deps = {
      platform: jest.fn(() => 'windows' as const),
      docker: jest.fn(() => null),
      loadConfig: jest.fn(() => config),
      saveConfig: jest.fn((next: GlobalConfig) => { config = next; return true; }),
      instances: jest.fn(async () => [
        { id: 'a', name: 'Island', gamePort: 7777, queryPort: 27015, rconPort: 27020 },
        { id: 'b', name: 'Center', gamePort: 7967, queryPort: 27016, rconPort: 27021 }
      ]),
      root: jest.fn(() => 'C:\\AASM'),
      readFirewall: jest.fn(async () => open),
      openFirewall: jest.fn(async () => ({ success: true as const, status: open })),
      now: jest.fn(() => now),
      ...overrides
    } as jest.Mocked<ServerPortsDeps>;
    return new ServerPortsService(deps);
  }

  beforeEach(() => {
    config = { webServerPort: 3000 } as GlobalConfig;
    now = 1_000_000;
  });

  describe('state', () => {
    it('on Windows: the ranges, how Windows Firewall stands, and the servers outside them', async () => {
      await expect(service().state()).resolves.toEqual({
        ranges: DEFAULT_SERVER_PORT_RANGES,
        source: 'settings',
        platform: 'windows',
        windowsFirewall: open,
        linuxCommands: null,
        outside: [{ id: 'b', name: 'Center', ports: [expect.objectContaining({ label: 'Game', port: 7967 }), expect.objectContaining({ label: 'Peer', port: 7968 })] }]
      });
      expect(deps.readFirewall).toHaveBeenCalledWith(DEFAULT_SERVER_PORT_RANGES, 'C:\\AASM');
    });

    it('says why when Windows Firewall cannot be read', async () => {
      const state = await service({ readFirewall: jest.fn(async () => ({ error: 'Could not read Windows Firewall: boom' })) }).state();
      expect(state).toEqual(expect.objectContaining({ windowsFirewall: null, windowsFirewallError: 'Could not read Windows Firewall: boom' }));
    });

    it('on Linux: the commands to open the ranges, and no Windows Firewall', async () => {
      const state = await service({ platform: jest.fn(() => 'linux' as const) }).state();
      expect(state.windowsFirewall).toBeNull();
      expect(state.linuxCommands).toContain('sudo ufw allow 7777:7900/udp');
      expect(deps.readFirewall).not.toHaveBeenCalled();
    });

    it('in Docker: the ranges docker-compose.yml publishes, and nothing to open', async () => {
      const docker = { mode: 'published' as const, gamePorts: custom.game, queryPorts: custom.query, rconPorts: custom.rcon, webPort: 3000 };
      const state = await service({ platform: jest.fn(() => 'linux' as const), docker: jest.fn(() => docker) }).state();
      expect(state).toEqual(expect.objectContaining({ ranges: custom, source: 'docker', windowsFirewall: null, linuxCommands: null }));
    });
  });

  describe('setRanges', () => {
    it('saves them for this machine', async () => {
      const result = await service().setRanges(custom);

      expect(result).toEqual({ success: true, state: expect.objectContaining({ ranges: custom }) });
      expect(deps.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ webServerPort: 3000, serverPorts: custom }));
    });

    it('refuses ranges that cannot be used', async () => {
      await expect(service().setRanges({ ...custom, game: { start: 7100, end: 7000 } }))
        .resolves.toEqual({ success: false, error: 'The game ports end before they start.' });
      expect(deps.saveConfig).not.toHaveBeenCalled();
    });

    it('leaves them to docker-compose.yml in Docker', async () => {
      const docker = { mode: 'published' as const, gamePorts: custom.game, queryPorts: custom.query, rconPorts: custom.rcon, webPort: 3000 };
      await expect(service({ docker: jest.fn(() => docker) }).setRanges(custom)).resolves.toEqual({
        success: false,
        error: 'In Docker these come from docker-compose.yml: set AASM_GAME_PORTS, AASM_QUERY_PORTS and AASM_RCON_PORTS there.'
      });
    });
  });

  describe('openFirewall', () => {
    it('opens this machine\'s ranges in Windows Firewall', async () => {
      config = { ...config, serverPorts: custom };

      await expect(service().openFirewall()).resolves.toEqual({ success: true, state: expect.objectContaining({ windowsFirewall: open }) });
      expect(deps.openFirewall).toHaveBeenCalledWith(custom, 'C:\\AASM');
    });

    it('passes on why it could not', async () => {
      const failed = jest.fn(async () => ({ success: false as const, error: 'Windows asked for permission and it was not given, so nothing changed.' }));
      await expect(service({ openFirewall: failed }).openFirewall()).resolves.toEqual({
        success: false, error: 'Windows asked for permission and it was not given, so nothing changed.', state: expect.anything()
      });
    });

    it('is only for Windows', async () => {
      await expect(service({ platform: jest.fn(() => 'linux' as const) }).openFirewall())
        .resolves.toEqual({ success: false, error: 'Only Windows can open its firewall from here. On Linux, run the commands shown.' });
    });
  });

  // For the mesh heartbeat, which runs every few seconds and cannot wait on PowerShell.
  describe('portsOpen', () => {
    it('is unknown away from Windows, and in Docker', () => {
      expect(service({ platform: jest.fn(() => 'linux' as const) }).portsOpen()).toBeNull();
    });

    it('is unknown until it has been read, and reads it in the background', async () => {
      const ports = service();
      expect(ports.portsOpen()).toBeNull();
      await Promise.resolve();
      await Promise.resolve();
      expect(deps.readFirewall).toHaveBeenCalledTimes(1);
      expect(ports.portsOpen()).toBe(true);
    });

    it('keeps what it last read for ten minutes, then reads again', async () => {
      const read = jest.fn(async () => missing);
      const ports = service({ readFirewall: read });
      await ports.state();
      expect(ports.portsOpen()).toBe(false);
      expect(read).toHaveBeenCalledTimes(1);

      now += 10 * 60_000 + 1;
      ports.portsOpen();
      expect(read).toHaveBeenCalledTimes(2);
    });

    it('reads again at once after the ranges change', async () => {
      const ports = service();
      await ports.state();
      await ports.setRanges(custom);
      expect(deps.readFirewall).toHaveBeenLastCalledWith(custom, 'C:\\AASM');
    });
  });
});
