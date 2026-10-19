import * as fs from 'fs';
import * as path from 'path';
import { safeStorage } from 'electron';
import { getDefaultInstallDir } from './platform.utils';

/** The desktop mesh sign-in, kept so the next launch can sign in again. The password is encrypted. */
export interface RememberedLogin {
  username: string;
  password: string;
}

function loginFile(dir = getDefaultInstallDir()): string {
  return path.join(dir, 'remembered-login.bin');
}

/** True when the OS can encrypt the password. Without that, nothing is stored. */
export function canRememberLogin(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function saveRememberedLogin(login: RememberedLogin, dir = getDefaultInstallDir()): boolean {
  if (!login.username || !login.password || !canRememberLogin()) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(loginFile(dir), safeStorage.encryptString(JSON.stringify({
    username: login.username,
    password: login.password
  })), { mode: 0o600 });
  return true;
}

export function loadRememberedLogin(dir = getDefaultInstallDir()): RememberedLogin | null {
  const file = loginFile(dir);
  if (!fs.existsSync(file) || !canRememberLogin()) return null;
  try {
    const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) as Partial<RememberedLogin>;
    if (!parsed.username || !parsed.password) return null;
    return { username: parsed.username, password: parsed.password };
  } catch (error) {
    console.warn('[login] Could not read the remembered login:', error);
    return null;
  }
}

export function clearRememberedLogin(dir = getDefaultInstallDir()): void {
  fs.rmSync(loginFile(dir), { force: true });
}
