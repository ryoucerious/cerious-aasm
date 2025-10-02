/**
 * Input Validation Utilities
 * Pure helper functions for input validation and sanitization
 */

/**
 * Validate server instance IDs (alphanumeric, dash, underscore)
 * @param id - ID to validate
 * @returns True if valid instance ID
 */
export function validateInstanceId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  return /^[a-zA-Z0-9_-]{1,50}$/.test(id);
}

/**
 * Validate port numbers
 * @param port - Port number to validate
 * @returns True if valid port number
 */
export function validatePort(port: number | string): boolean {
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;
  return Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535;
}

/**
 * Validate server names (allow most characters but prevent control chars)
 * @param name - Server name to validate
 * @returns True if valid server name
 */
export function validateServerName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  if (name.length > 100) return false;
  // Allow alphanumeric, spaces, common punctuation, but no control characters
  return /^[a-zA-Z0-9\s\-_().,:;!@#$%^&*+=\[\]{}|\\\/'"?<>~`]{1,100}$/.test(name);
}

/**
 * Sanitize string inputs (remove potential harmful characters)
 * @param input - String to sanitize
 * @returns Sanitized string
 */
export function sanitizeString(input: string): string {
  if (!input || typeof input !== 'string') return '';
  // Remove control characters but preserve printable characters
  return input.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

/**
 * Validate authentication inputs
 * @param username - Username to validate
 * @param password - Password to validate
 * @returns Validation result with error message if invalid
 */
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

/**
 * Validate email address format
 * @param email - Email to validate
 * @returns True if valid email format
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  // RFC 5322 compliant email regex (simplified but more accurate)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email) && email.includes('.');
}

/**
 * Validate IP address format (IPv4)
 * @param ip - IP address to validate
 * @returns True if valid IPv4 address
 */
export function validateIPAddress(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false;
  const ipRegex = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/;
  return ipRegex.test(ip);
}

/**
 * Validate filename (no path separators or invalid characters)
 * @param filename - Filename to validate
 * @returns True if valid filename
 */
export function validateFilename(filename: string): boolean {
  if (!filename || typeof filename !== 'string') return false;
  // Disallow path separators and invalid characters
  return !/[<>:"/\\|?*\x00-\x1f]/.test(filename) && filename.length > 0 && filename.length <= 255;
}

/**
 * Sanitize filename for safe file system usage
 * @param filename - Filename to sanitize
 * @returns Sanitized filename
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') return 'unnamed';
  
  // Replace invalid characters with underscore
  let sanitized = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  
  // Remove leading/trailing spaces and dots
  sanitized = sanitized.trim().replace(/^\.+|\.+$/g, '');
  
  // Ensure not empty
  if (!sanitized) sanitized = 'unnamed';
  
  // Limit length
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }
  
  return sanitized;
}

/**
 * Validate URL format
 * @param url - URL to validate
 * @returns True if valid URL format
 */
export function validateURL(url: string): boolean {
  if (!url || typeof url !== 'string') return false;

  // Basic protocol check - allow common protocols
  if (!/^(https?|ftp):\/\/.+/.test(url)) return false;

  try {
    const parsedUrl = new URL(url);
    // Additional checks: must have protocol and hostname
    return !!(parsedUrl.protocol && parsedUrl.hostname);
  } catch {
    return false;
  }
}

/**
 * Check if string is numeric
 * @param value - String to check
 * @returns True if string represents a number
 */
export function isNumeric(value: string): boolean {
  return !isNaN(Number(value)) && !isNaN(parseFloat(value));
}