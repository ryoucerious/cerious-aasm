/**
 * Crypto Utilities - Handles cryptographic operations and password generation
 */

/**
 * Generate a random password using alphanumeric characters
 * @param length The length of the password to generate
 * @returns A randomly generated password string
 */
export function generateRandomPassword(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}