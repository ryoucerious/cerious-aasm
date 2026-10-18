import { fileToBase64, desktopFilePath } from './file.utils';

describe('fileToBase64', () => {
  it('resolves modern Electron files through the preload, with no File.path', () => {
    const previous = window.electronAPI;
    const file = new File(['zip'], 'plugin.zip');
    try {
      const getPathForFile = jasmine.createSpy().and.returnValue('C:/plugins/plugin.zip');
      window.electronAPI = { getPathForFile } as any;
      expect(desktopFilePath(file)).toBe('C:/plugins/plugin.zip');
      expect(getPathForFile).toHaveBeenCalledWith(file);
      delete window.electronAPI;
      expect(desktopFilePath(file)).toBe('');
    } finally { window.electronAPI = previous; }
  });
  it('gives the file\'s bytes as base64, without the data URL prefix', async () => {
    const file = new File([new Uint8Array([80, 75, 3, 4])], 'plugin.zip', { type: 'application/zip' });

    expect(await fileToBase64(file)).toBe('UEsDBA==');
  });
});
