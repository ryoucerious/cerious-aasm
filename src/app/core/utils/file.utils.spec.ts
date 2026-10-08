import { fileToBase64 } from './file.utils';

describe('fileToBase64', () => {
  it('gives the file\'s bytes as base64, without the data URL prefix', async () => {
    const file = new File([new Uint8Array([80, 75, 3, 4])], 'plugin.zip', { type: 'application/zip' });

    expect(await fileToBase64(file)).toBe('UEsDBA==');
  });
});
