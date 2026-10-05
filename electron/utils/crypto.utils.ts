import { randomInt } from 'crypto';

const PASSWORD_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A random alphanumeric password from the crypto RNG, for secrets such as RCON passwords. */
export function generateRandomPassword(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += PASSWORD_CHARACTERS[randomInt(PASSWORD_CHARACTERS.length)];
  }
  return result;
}
