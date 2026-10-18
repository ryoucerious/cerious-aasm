/**
 * A chosen file's bytes as base64, to send with a request. For clients with no path to the file
 * on disk, such as the web UI.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
/** Only the preload can resolve a file picked in a modern Electron renderer. */
export function desktopFilePath(file: File): string {
  try {
    return window.electronAPI?.getPathForFile?.(file) || (file as File & { path?: string }).path || '';
  } catch {
    return '';
  }
}
