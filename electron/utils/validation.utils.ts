/** Instance ids name directories, so only [A-Za-z0-9_-]{1,50} is allowed: no dots or separators. */
export function validateInstanceId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,50}$/.test(id);
}

/** A port the app may be told to listen on: 1024-65535, so no privileged ports. */
export function validatePort(port: number | string): boolean {
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;
  return Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535;
}

/** Any TCP port, 1-65535, from a number or a string of digits; undefined otherwise. */
export function parsePort(value: unknown): number | undefined {
  const port = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

/** Allows most punctuation but no control characters. */
export function validateServerName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  if (name.length > 100) return false;
  return /^[a-zA-Z0-9\s\-_().,:;!@#$%^&*+=\[\]{}|\\\/'"?<>~`]{1,100}$/.test(name);
}

/** For display strings: strips control characters and trims. Never use it on a password. */
export function sanitizeString(input: string): string {
  if (!input || typeof input !== 'string') return '';
  return input.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

export function validateAuthInput(username: string, password: string): { valid: boolean; error?: string } {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username is required' };
  }
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (username.length > 50) {
    return { valid: false, error: 'Username too long' };
  }
  if (password.length > 200) {
    return { valid: false, error: 'Password too long' };
  }
  return { valid: true };
}

export function validateIPAddress(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false;
  const octets = ip.split('.');
  if (octets.length !== 4) return false;
  return octets.every(octet => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    // Zero-padded octets ("010") are refused: some resolvers read them as octal.
    if (octet.length > 1 && octet.startsWith('0')) return false;
    return Number(octet) <= 255;
  });
}

/** A single path segment: no separators or characters Windows forbids. */
export function validateFilename(filename: string): boolean {
  if (!filename || typeof filename !== 'string') return false;
  return !/[<>:"/\\|?*\x00-\x1f]/.test(filename) && filename.length > 0 && filename.length <= 255;
}

export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') return 'unnamed';

  let sanitized = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  sanitized = sanitized.trim().replace(/^\.+|\.+$/g, '');
  if (!sanitized) sanitized = 'unnamed';
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }
  return sanitized;
}

/** An absolute http, https or ftp URL with a hostname. */
export function validateURL(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (!/^(https?|ftp):\/\/.+/.test(url)) return false;

  try {
    const parsedUrl = new URL(url);
    return !!(parsedUrl.protocol && parsedUrl.hostname);
  } catch {
    return false;
  }
}
