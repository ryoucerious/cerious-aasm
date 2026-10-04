/**
 * Saves base64-encoded bytes as a file through a temporary link.
 * Throws a DOMException if `base64` is not valid base64.
 */
export function downloadBase64File(base64: string, fileName: string, mimeType: string): void {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
