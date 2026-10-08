import { arkApiPluginService } from './ark-api-plugin.service';
import { isAsaApiLoaderInstalled } from '../utils/ark/ark-server/ark-server-paths.utils';
import { isReadOnlyArkApiAction, runArkApiAction } from './ark-api-actions';

jest.mock('./ark-api-plugin.service', () => ({
  arkApiPluginService: {
    listPlugins: jest.fn(() => [{ folderName: 'Permissions' }]),
    removePlugin: jest.fn(),
    installPluginFromZipData: jest.fn(),
    installPluginFromUrl: jest.fn(async () => undefined),
    downloadAsaApi: jest.fn(async () => undefined)
  }
}));
jest.mock('../utils/ark/ark-server/ark-server-paths.utils', () => ({ isAsaApiLoaderInstalled: jest.fn(() => true) }));

const plugins = jest.mocked(arkApiPluginService);

// One place that does the ArkApi work, on whichever machine runs the server: called by the page's
// requests for a server here, and by the mesh for a server another machine sends here.
describe('ArkApi actions', () => {
  it('says whether AsaApi is installed, and lists the plugins', async () => {
    expect(await runArkApiAction('isle', 'status', {})).toEqual({ success: true, installed: true, loaderExe: 'AsaApiLoader.exe' });
    jest.mocked(isAsaApiLoaderInstalled).mockReturnValueOnce(false);
    expect(await runArkApiAction('isle', 'status', {})).toEqual({ success: true, installed: false, loaderExe: null });
    expect(await runArkApiAction('isle', 'list', {})).toEqual({ success: true, plugins: [{ folderName: 'Permissions' }] });
  });

  it('removes, installs and downloads', async () => {
    expect(await runArkApiAction('isle', 'remove', { folderName: 'Permissions' })).toEqual({ success: true, folderName: 'Permissions' });
    expect(plugins.removePlugin).toHaveBeenCalledWith('isle', 'Permissions');

    expect(await runArkApiAction('isle', 'install-zip', { zipData: 'UEsDBA==' })).toEqual({ success: true });
    expect(plugins.installPluginFromZipData).toHaveBeenCalledWith('isle', 'UEsDBA==');

    expect(await runArkApiAction('isle', 'install-url', { url: 'https://example.com/p.zip' })).toEqual({ success: true });
    expect(plugins.installPluginFromUrl).toHaveBeenCalledWith('isle', 'https://example.com/p.zip');

    expect(await runArkApiAction('isle', 'download-asaapi', { downloadUrl: 'https://example.com/a.zip' })).toEqual({ success: true });
    expect(plugins.downloadAsaApi).toHaveBeenCalledWith('isle', 'https://example.com/a.zip');
  });

  it('refuses a ZIP larger than a plugin needs to be', async () => {
    const tooLarge = 'A'.repeat(Math.ceil((50 * 1024 * 1024 + 1) / 3) * 4);

    expect(await runArkApiAction('isle', 'install-zip', { zipData: tooLarge })).toEqual({ success: false, error: 'That ZIP is larger than 50 MB.' });
    expect(plugins.installPluginFromZipData).not.toHaveBeenCalled();
  });

  it('tells reads from changes, and refuses what it does not know', async () => {
    expect(isReadOnlyArkApiAction('status')).toBe(true);
    expect(isReadOnlyArkApiAction('list')).toBe(true);
    expect(isReadOnlyArkApiAction('remove')).toBe(false);
    await expect(runArkApiAction('isle', 'format-disk' as never, {})).rejects.toThrow('Unknown ArkApi action');
  });
});
