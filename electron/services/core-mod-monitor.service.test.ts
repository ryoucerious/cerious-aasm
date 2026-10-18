import axios from 'axios';
import { CoreModMonitor } from './core-mod-monitor.service';
import { getAllInstances, getInstance } from '../utils/ark/instance.utils';
import { restartCountdowns } from './automation/restart-countdown.service';
import { localRuntime } from './runtime/local-runtime';
import { localNode, meshServer } from './mesh/mesh-hooks';
jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../utils/ark/instance.utils', () => ({ getAllInstances: jest.fn(), getInstance: jest.fn() }));
jest.mock('../utils/platform.utils', () => ({ getDefaultInstallDir: () => '/app' }));
jest.mock('../utils/global-config.utils', () => ({ loadGlobalConfig: () => ({ curseForgeApiKey: 'key', updateWarningMinutes: 5 }) }));
jest.mock('../utils/fs.utils', () => ({ readJsonOrQuarantine: () => ({}), writeJsonAtomic: jest.fn() }));
jest.mock('./mesh/mesh-hooks', () => ({ localNode: jest.fn(() => 'here'), meshServer: jest.fn(() => null) }));
jest.mock('./automation/restart-countdown.service', () => ({ restartCountdowns: { begin: jest.fn(), pending: () => [] } }));
jest.mock('./runtime/local-runtime', () => ({ localRuntime: { state: () => 'running', stop: jest.fn(async () => ({ success: true })), start: jest.fn(async () => ({ started: true })) } }));

describe('Core mod updates', () => {
  beforeEach(() => {
    jest.mocked(localNode).mockReturnValue('here');
    jest.mocked(meshServer).mockReturnValue(null);
  });
  it.each([null, 'here'])('rechecks placement before restarting a server (node %p)', async node => {
    jest.mocked(localNode).mockReturnValue(node);
    jest.mocked(meshServer).mockReturnValue(node ? { nodeId: node } as any : null);
    const server = { id: 'a', mods: ['12'], coreMods: ['12'] };
    jest.mocked(getAllInstances).mockResolvedValue([server] as any);
    jest.mocked(getInstance).mockReturnValue(server);
    const monitor = new CoreModMonitor();
    jest.mocked(axios.get).mockResolvedValue({ data: { data: { latestFiles: [{ id: 100 }] } } });
    await monitor.check();
    jest.mocked(axios.get).mockResolvedValue({ data: { data: { latestFiles: [{ id: 101 }] } } });
    await monitor.check();
    expect(restartCountdowns.begin).toHaveBeenCalledTimes(1);
    jest.mocked(meshServer).mockReturnValue({ nodeId: 'elsewhere' } as any);
    await jest.mocked(restartCountdowns.begin).mock.calls[0][3](['a']);
    expect(localRuntime.stop).not.toHaveBeenCalled();
    jest.mocked(axios.get).mockClear();
    await monitor.check();
    expect(axios.get).not.toHaveBeenCalled();
  });
  it('baselines without restarting and restarts only servers marking the updated enabled mod core', async () => {
    const monitor = new CoreModMonitor();
    const servers = [{ id: 'a', mods: ['12'], coreMods: ['12'] }, { id: 'b', mods: ['12'], coreMods: [] }, { id: 'c', mods: ['12'], enabledMods: [], coreMods: ['12'] }];
    jest.mocked(getAllInstances).mockResolvedValue(servers as any);
    jest.mocked(getInstance).mockReturnValue(servers[0]);
    jest.mocked(axios.get).mockResolvedValue({ data: { data: { latestFiles: [{ id: 100 }] } } });
    await monitor.check();
    expect(restartCountdowns.begin).not.toHaveBeenCalled();
    jest.mocked(axios.get).mockResolvedValue({ data: { data: { latestFiles: [{ id: 101 }] } } });
    await monitor.check();
    expect(restartCountdowns.begin).toHaveBeenCalledTimes(1);
    expect(restartCountdowns.begin).toHaveBeenCalledWith(['a'], 5, false, expect.any(Function));
    await jest.mocked(restartCountdowns.begin).mock.calls[0][3](['a']);
    expect(localRuntime.stop).toHaveBeenCalledWith('a');
    expect(localRuntime.start).toHaveBeenCalledWith('a');
    await monitor.check();
    expect(restartCountdowns.begin).toHaveBeenCalledTimes(1);
  });
  it('does not restart on failed API checks', async () => {
    jest.mocked(getAllInstances).mockResolvedValue([{ id: 'a', mods: ['12'], coreMods: ['12'] }] as any);
    jest.mocked(axios.get).mockRejectedValue(new Error('403'));
    await new CoreModMonitor().check();
    expect(restartCountdowns.begin).not.toHaveBeenCalled();
  });
});
