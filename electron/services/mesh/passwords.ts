import { randomBytes, createHash, timingSafeEqual } from 'crypto';

const MEMORY_KIB = 19456;
const ITERATIONS = 2;
const PARALLELISM = 1;

export interface PasswordVerifier {
  hash: string;
  parameters: string;
  hashAlg: 'argon2id' | 'bcrypt';
}

interface ArgonApi {
  argon2id(options: {
    password: string;
    salt: Buffer;
    parallelism: number;
    iterations: number;
    memorySize: number;
    hashLength: number;
    outputType: 'encoded';
  }): Promise<string>;
  argon2Verify(options: { password: string; hash: string }): Promise<boolean>;
}

function argon(): ArgonApi {
  return require('hash-wasm') as ArgonApi;
}

/** Argon2id encoded hash. Parameters travel with the row so a later node can verify them. */
export async function hashArgon2id(password: string): Promise<PasswordVerifier> {
  const hash = await argon().argon2id({
    password,
    salt: randomBytes(16),
    parallelism: PARALLELISM,
    iterations: ITERATIONS,
    memorySize: MEMORY_KIB,
    hashLength: 32,
    outputType: 'encoded'
  });
  return {
    hash,
    parameters: `argon2id:m=${MEMORY_KIB},t=${ITERATIONS},p=${PARALLELISM}`,
    hashAlg: 'argon2id'
  };
}

export async function verifyArgon2id(password: string, hash: string): Promise<boolean> {
  try {
    return await argon().argon2Verify({ password, hash });
  } catch {
    return false;
  }
}

export async function verifyBcrypt(password: string, hash: string): Promise<boolean> {
  const bcrypt = require('bcrypt') as { compare(password: string, hash: string): Promise<boolean> };
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/** SHA-256 of an enrollment token. The token itself is shown once and never stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newEnrollmentToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
}

/** Constant-time compare for hex digests of equal length. */
export function tokenMatches(presentedHash: string, storedHash: string): boolean {
  const a = Buffer.from(presentedHash);
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
