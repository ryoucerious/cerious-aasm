jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  mkdirSync: jest.fn()
}));
jest.mock('../../platform.utils', () => ({
  getPlatform: jest.fn(() => 'linux')
}));
jest.mock('../../ark/instance.utils', () => ({
  getInstancesBaseDir: jest.fn(() => '/instances')
}));
jest.mock('./ark-server-install.utils', () => ({
  getArkServerDir: jest.fn(() => '/ark')
}));

const fs = require('fs');
const { getPlatform } = require('../../platform.utils');
const { withInstancePlugins, resolvePluginViewHelper } = require('./plugin-view.utils');

describe('withInstancePlugins', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPlatform.mockReturnValue('linux');
    fs.existsSync.mockReturnValue(false);
  });

  it('leaves the command alone when the loader is not the shared one', () => {
    const launch = withInstancePlugins('proton', ['waitforexitandrun'], 'inst-1', false);
    expect(launch).toEqual({ command: 'proton', args: ['waitforexitandrun'] });
  });

  it('leaves the command alone on Windows', () => {
    getPlatform.mockReturnValue('windows');
    const launch = withInstancePlugins('ArkAscendedServer.exe', ['TheIsland_WP'], 'inst-1', true);
    expect(launch.command).toBe('ArkAscendedServer.exe');
  });

  it('wraps a shared-loader launch so the server sees its own plugin folder', () => {
    fs.existsSync.mockImplementation((candidate: string) => candidate === '/usr/local/bin/aasm-plugin-view');
    const launch = withInstancePlugins('proton', ['waitforexitandrun', 'Z:\\loader'], 'inst-1', true);
    expect(launch.command).toBe('/usr/local/bin/aasm-plugin-view');
    expect(launch.args).toEqual([
      '--bind',
      '/instances/inst-1/ShooterGame/Binaries/Win64/ArkApi/Plugins',
      '/ark/ShooterGame/Binaries/Win64/ArkApi/Plugins',
      '--bind',
      '/instances/inst-1/Config/WindowsServer',
      '/ark/ShooterGame/Saved/Config/WindowsServer',
      '--',
      'proton',
      'waitforexitandrun',
      'Z:\\loader'
    ]);
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      '/instances/inst-1/ShooterGame/Binaries/Win64/ArkApi/Plugins',
      { recursive: true }
    );
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      '/instances/inst-1/Config/WindowsServer',
      { recursive: true }
    );
  });

  it('reports no helper when the mount tool is absent', () => {
    expect(resolvePluginViewHelper()).toBeNull();
  });
});
