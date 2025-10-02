import { ServerInstallerService } from './server-installer.service';
import * as platformUtils from '../utils/platform.utils';
import * as systemDepsUtils from '../utils/system-deps.utils';
import * as protonUtils from '../utils/proton.utils';
import * as steamcmdUtils from '../utils/steamcmd.utils';
import * as arkUtils from '../utils/ark.utils';

jest.mock('fs-extra', () => ({
  existsSync: jest.fn(() => true)
}));

jest.mock('../utils/ark.utils', () => ({
  installArkServer: jest.fn((cb, progressCb) => cb(null)),
  ArkPathUtils: {
    getArkServerDir: jest.fn(() => '/ark/server'),
    getArkExecutablePath: jest.fn(() => '/ark/server/ark.exe')
  }
}));

describe('ServerInstallerService', () => {
  let service: ServerInstallerService;
  let progressCallback: jest.Mock;

  beforeEach(() => {
    service = new ServerInstallerService();
    progressCallback = jest.fn();
    jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
    jest.spyOn(systemDepsUtils, 'checkAllDependencies').mockResolvedValue([]);
    jest.spyOn(systemDepsUtils, 'installMissingDependencies').mockResolvedValue({ success: true, message: 'done', details: [] });
    jest.spyOn(protonUtils, 'isProtonInstalled').mockReturnValue(true);
    jest.spyOn(protonUtils, 'installProton').mockImplementation((cb, progressCb) => cb(null));
    jest.spyOn(steamcmdUtils, 'isSteamCmdInstalled').mockReturnValue(true);
    jest.spyOn(steamcmdUtils, 'installSteamCmd').mockImplementation((cb, progressCb) => cb(null));
  // existsSync is already mocked above
    // arkUtils.installArkServer and ArkPathUtils are already mocked above
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('installServer completes successfully', async () => {
    const result = await service.installServer(progressCallback, 'pass');
    expect(result.success).toBe(true);
    expect(result.message).toContain('completed successfully');
    expect(progressCallback).toHaveBeenCalled();
  });

  it('installServer fails if validation fails', async () => {
    jest.spyOn(require('fs-extra'), 'existsSync').mockImplementation((p) => p !== '/ark/server/ark.exe');
    const result = await service.installServer(progressCallback, 'pass');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Installation validation failed');
  });

  it('installServer fails if missing dependencies and no sudo password', async () => {
    jest.spyOn(systemDepsUtils, 'checkAllDependencies').mockResolvedValue([
      { installed: false, dependency: { name: 'dep', packageName: 'pkg', checkCommand: 'cmd', description: 'desc', required: true } }
    ]);
    const result = await service.installServer(progressCallback);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Sudo password required');
  });

  it('installServer fails if installMissingDependencies fails', async () => {
    jest.spyOn(systemDepsUtils, 'checkAllDependencies').mockResolvedValue([
      { installed: false, dependency: { name: 'dep', packageName: 'pkg', checkCommand: 'cmd', description: 'desc', required: true } }
    ]);
    jest.spyOn(systemDepsUtils, 'installMissingDependencies').mockResolvedValue({ success: false, message: 'fail', details: [] });
    const result = await service.installServer(progressCallback, 'pass');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to install Linux dependencies');
  });

  it('installServer fails if installProton fails', async () => {
    jest.spyOn(protonUtils, 'isProtonInstalled').mockReturnValue(false);
    jest.spyOn(protonUtils, 'installProton').mockImplementation((cb, progressCb) => cb(new Error('fail')));
    const result = await service.installServer(progressCallback, 'pass');
    expect(result.success).toBe(false);
    expect(result.message).toContain('fail');
  });

  it('installServer fails if installSteamCmd fails', async () => {
    jest.spyOn(steamcmdUtils, 'isSteamCmdInstalled').mockReturnValue(false);
    jest.spyOn(steamcmdUtils, 'installSteamCmd').mockImplementation((cb, progressCb) => cb(new Error('fail')));
    const result = await service.installServer(progressCallback, 'pass');
    expect(result.success).toBe(false);
    expect(result.message).toContain('fail');
  });

  it('installServer fails if installArkServer fails', async () => {
    jest.spyOn(arkUtils, 'installArkServer').mockImplementation((cb, progressCb) => cb(new Error('fail')));
    const result = await service.installServer(progressCallback, 'pass');
    expect(result.success).toBe(false);
    expect(result.message).toContain('fail');
  });
  
});
