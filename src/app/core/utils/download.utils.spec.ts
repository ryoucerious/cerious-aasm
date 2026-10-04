import { downloadBase64File } from './download.utils';

describe('downloadBase64File', () => {
  let anchor: jasmine.SpyObj<HTMLAnchorElement>;
  let blob: Blob | undefined;

  beforeEach(() => {
    anchor = jasmine.createSpyObj<HTMLAnchorElement>('HTMLAnchorElement', ['click']);
    blob = undefined;
    spyOn(document, 'createElement').and.returnValue(anchor);
    spyOn(document.body, 'appendChild');
    spyOn(document.body, 'removeChild');
    spyOn(URL, 'createObjectURL').and.callFake((value: Blob | MediaSource) => {
      blob = value as Blob;
      return 'blob:mock-url';
    });
    spyOn(URL, 'revokeObjectURL');
  });

  it('clicks a temporary link to the decoded bytes, then cleans up', async () => {
    downloadBase64File(btoa('hello'), 'hello.txt', 'text/plain');

    expect(anchor.download).toBe('hello.txt');
    expect(anchor.href).toBe('blob:mock-url');
    expect(anchor.click).toHaveBeenCalled();
    expect(document.body.removeChild).toHaveBeenCalledWith(anchor);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(blob!.type).toBe('text/plain');
    expect(await blob!.text()).toBe('hello');
  });

  it('throws on data that is not base64', () => {
    expect(() => downloadBase64File('!!!notbase64', 'x.zip', 'application/zip')).toThrow();
    expect(anchor.click).not.toHaveBeenCalled();
  });
});
