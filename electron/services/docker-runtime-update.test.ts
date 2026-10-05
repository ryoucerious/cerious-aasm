import { assertArchivePaths, findRuntimeAsset, RUNTIME_ASSET_NAME } from './docker-runtime-update';

describe('docker runtime update', () => {
  it('finds the runtime archive published with a release', () => {
    const asset = findRuntimeAsset([
      { name: 'Cerious.AASM.Setup.exe', browser_download_url: 'https://example/setup', size: 1 },
      { name: RUNTIME_ASSET_NAME, browser_download_url: 'https://example/runtime', size: 2 }
    ]);
    expect(asset?.browser_download_url).toBe('https://example/runtime');
  });

  it('accepts an archive that stays inside its directory', () => {
    expect(() => assertArchivePaths(['package.json', 'dist/index.html', 'electron/main.js'])).not.toThrow();
  });

  it('rejects an archive that escapes its directory', () => {
    expect(() => assertArchivePaths(['package.json', '../etc/passwd'])).toThrow(/unsafe path/);
    expect(() => assertArchivePaths(['/etc/passwd'])).toThrow(/unsafe path/);
  });
});
