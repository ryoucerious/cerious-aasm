/**
 * Puts `text` on the clipboard; rejects when the browser refuses.
 *
 * navigator.clipboard exists only in secure contexts, and the web UI is often served over plain
 * HTTP on a LAN, so without it (or when it refuses) this falls back to the older copy command.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Refused, e.g. while the document is not focused; the copy command may still work.
    }
  }
  copyWithCommand(text);
}

function copyWithCommand(text: string): void {
  // Selecting the text moves focus; the button that asked for the copy gets it back.
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    if (!document.execCommand('copy')) {
      throw new Error('The browser refused to copy');
    }
  } finally {
    textarea.remove();
    focused?.focus();
  }
}
