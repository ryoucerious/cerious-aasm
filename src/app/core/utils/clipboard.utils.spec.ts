import { copyToClipboard } from './clipboard.utils';

describe('copyToClipboard', () => {
  function captureCopyCommand(result: boolean): () => string {
    let copied = '';
    spyOn(document, 'execCommand').and.callFake((command: string) => {
      if (command === 'copy') copied = (document.activeElement as HTMLTextAreaElement).value;
      return result;
    });
    return () => copied;
  }

  it('uses the Clipboard API when there is one', async () => {
    spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.resolve());
    spyOn(document, 'execCommand');

    await copyToClipboard('abc');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc');
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('falls back to the copy command when the Clipboard API refuses', async () => {
    spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.reject(new DOMException('Document is not focused')));
    const copied = captureCopyCommand(true);

    await copyToClipboard('abc');

    expect(copied()).toBe('abc');
  });

  it('falls back to the copy command on a page without the Clipboard API, and cleans up', async () => {
    spyOnProperty(navigator, 'clipboard').and.returnValue(undefined as unknown as Clipboard);
    const copied = captureCopyCommand(true);
    const textareas = document.querySelectorAll('textarea').length;

    await copyToClipboard('line one\nline two');

    expect(copied()).toBe('line one\nline two');
    expect(document.querySelectorAll('textarea').length).toBe(textareas);
  });

  it('gives focus back to what had it', async () => {
    spyOnProperty(navigator, 'clipboard').and.returnValue(undefined as unknown as Clipboard);
    captureCopyCommand(true);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    await copyToClipboard('abc');

    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it('rejects when the copy command is refused too', async () => {
    spyOnProperty(navigator, 'clipboard').and.returnValue(undefined as unknown as Clipboard);
    captureCopyCommand(false);

    await expectAsync(copyToClipboard('abc')).toBeRejected();
    expect(document.querySelectorAll('textarea[readonly]').length).toBe(0);
  });
});
