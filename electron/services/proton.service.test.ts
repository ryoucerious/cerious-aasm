import { ProtonService } from './proton.service';
import * as platformUtils from '../utils/platform.utils';
import * as protonUtils from '../utils/proton.utils';

describe('ProtonService', () => {
  let service: ProtonService;

  beforeEach(() => {
    service = new ProtonService();
    jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('checkProtonInstalled returns installed on linux', async () => {
    jest.spyOn(protonUtils, 'isProtonInstalled').mockReturnValue(true);
    jest.spyOn(protonUtils, 'getProtonDir').mockReturnValue('/proton');
    const result = await service.checkProtonInstalled();
    expect(result.success).toBe(true);
    expect(result.installed).toBe(true);
    expect(result.path).toBe('/proton');
    expect(result.message).toBe('Proton is installed');
  });

  it('checkProtonInstalled returns not installed on linux', async () => {
    jest.spyOn(protonUtils, 'isProtonInstalled').mockReturnValue(false);
    const result = await service.checkProtonInstalled();
    expect(result.success).toBe(true);
    expect(result.installed).toBe(false);
    expect(result.path).toBeNull();
    expect(result.message).toBe('Proton not installed');
  });

  it('checkProtonInstalled returns installed on non-linux', async () => {
    jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('windows');
    const result = await service.checkProtonInstalled();
    expect(result.success).toBe(true);
    expect(result.installed).toBe(true);
    expect(result.message).toBe('Proton not needed on Windows');
  });

  it('checkProtonInstalled handles error', async () => {
    jest.spyOn(protonUtils, 'isProtonInstalled').mockImplementation(() => { throw new Error('fail'); });
    const result = await service.checkProtonInstalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe('fail');
  });

  it('installProton returns success on non-linux', async () => {
    jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('windows');
    const result = await service.installProton();
    expect(result.success).toBe(true);
    expect(result.message).toBe('Proton not needed on Windows');
  });

  it('installProton returns already installed', async () => {
    jest.spyOn(protonUtils, 'isProtonInstalled').mockReturnValue(true);
    const result = await service.installProton();
    expect(result.success).toBe(true);
    expect(result.message).toBe('Proton is already installed');
  });

  it('installProton resolves success from installProton', async () => {
    jest.spyOn(protonUtils, 'isProtonInstalled').mockReturnValue(false);
    jest.spyOn(protonUtils, 'installProton').mockImplementation((cb, progressCb) => {
      cb(null, 'output');
    });
    const result = await service.installProton();
    expect(result.success).toBe(true);
    expect(result.message).toBe('Proton installed successfully');
    expect(result.output).toBe('output');
  });

  it('installProton resolves error from installProton', async () => {
    jest.spyOn(protonUtils, 'isProtonInstalled').mockReturnValue(false);
    jest.spyOn(protonUtils, 'installProton').mockImplementation((cb, progressCb) => {
  cb(new Error('fail'), undefined);
    });
    const result = await service.installProton();
    expect(result.success).toBe(false);
    expect(result.error).toBe('fail');
  });

  it('getProtonDirectory returns path', async () => {
    jest.spyOn(protonUtils, 'getProtonDir').mockReturnValue('/proton');
    const result = await service.getProtonDirectory();
    expect(result.success).toBe(true);
    expect(result.path).toBe('/proton');
  });

  it('getProtonDirectory handles error', async () => {
    jest.spyOn(protonUtils, 'getProtonDir').mockImplementation(() => { throw new Error('fail'); });
    const result = await service.getProtonDirectory();
    expect(result.success).toBe(false);
    expect(result.error).toBe('fail');
  });

  it('getPlatformInfo returns info for linux', async () => {
    jest.spyOn(protonUtils, 'isProtonInstalled').mockReturnValue(true);
    const result = await service.getPlatformInfo();
    expect(result.success).toBe(true);
    expect(result.platform).toBe('linux');
    expect(result.needsProton).toBe(true);
    expect(result.protonInstalled).toBe(true);
    expect(result.ready).toBe(true);
  });

  it('getPlatformInfo returns info for windows', async () => {
    jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('windows');
    const result = await service.getPlatformInfo();
    expect(result.success).toBe(true);
    expect(result.platform).toBe('windows');
    expect(result.needsProton).toBe(false);
    expect(result.protonInstalled).toBe(true);
    expect(result.ready).toBe(true);
  });

  it('getPlatformInfo handles error', async () => {
    jest.spyOn(protonUtils, 'isProtonInstalled').mockImplementation(() => { throw new Error('fail'); });
    const result = await service.getPlatformInfo();
    expect(result.success).toBe(false);
    expect(result.error).toBe('fail');
    expect(result.ready).toBe(false);
  });
});
