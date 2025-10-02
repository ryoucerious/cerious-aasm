import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';
import { getDefaultInstallDir } from '../utils/platform.utils';

// =============================================================================
// CONSTANTS & CONFIGURATION
// =============================================================================

const SALT_ROUNDS = 12;

// Authentication configuration interface
export interface AuthConfig {
  enabled: boolean;
  username: string;
  passwordHash: string;
}

// Global auth configuration state
let authConfig: AuthConfig = {
  enabled: false,
  username: '',
  passwordHash: ''
};

// Auth config persistence - store config in the installation directory's data folder
const authConfigFile = path.join(getDefaultInstallDir(), 'data', 'auth-config.json');

// Track initialization state
let authInitialized = false;

// =============================================================================
// AUTHENTICATION CONFIGURATION MANAGEMENT
// =============================================================================

/**
 * Load authentication configuration from disk
 */
export function loadAuthConfig(): void {
  try {
    if (fs.existsSync(authConfigFile)) {
      const data = fs.readFileSync(authConfigFile, 'utf-8');
      const savedConfig = JSON.parse(data);
      authConfig = { ...authConfig, ...savedConfig };
    }
  } catch (error) {
    console.error('[Auth] Failed to load saved auth config:', error);
  }
}

/**
 * Save authentication configuration to disk
 */
export function saveAuthConfig(): void {
  try {
    // Ensure data directory exists
    const dataDir = path.dirname(authConfigFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(authConfigFile, JSON.stringify(authConfig, null, 2), { mode: 0o600 });
  } catch (error) {
    console.error('[Auth] Failed to save auth config:', error);
  }
}

/**
 * Migrate old auth config from app directory to install directory
 */
export function migrateAuthConfig(): void {
  try {
    const oldAuthFile = path.join(process.cwd(), 'data', 'auth-config.json');
    const newAuthDir = path.dirname(authConfigFile);

    if (!fs.existsSync(newAuthDir)) {
      fs.mkdirSync(newAuthDir, { recursive: true });
    }

    if (fs.existsSync(oldAuthFile) && !fs.existsSync(authConfigFile)) {
      try {
        fs.renameSync(oldAuthFile, authConfigFile);
      } catch (e) {
        console.error('[Auth] Failed to migrate auth-config.json:', e);
      }
    }
  } catch (e) {
    console.error('[Auth] Auth config migration check failed:', e);
  }
}

// =============================================================================
// PASSWORD SECURITY
// =============================================================================

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  return await bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || typeof password !== 'string') {
    return false;
  }
  if (!hash || typeof hash !== 'string') {
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    console.error('[Auth] Password verification error:', error);
    return false;
  }
}

// =============================================================================
// AUTHENTICATION CONFIGURATION
// =============================================================================

/**
 * Update authentication configuration
 */
export function updateAuthConfig(config: AuthConfig): void {
  // Validate the configuration
  if (config.enabled) {
    if (!config.username || typeof config.username !== 'string') {
      console.error('[Auth] Invalid username in auth config');
      return;
    }
    if (!config.passwordHash || typeof config.passwordHash !== 'string') {
      console.error('[Auth] Invalid password hash in auth config');
      return;
    }
  }

  authConfig = { ...config };
  saveAuthConfig();
}

/**
 * Get current authentication configuration
 */
export function getAuthConfig(): AuthConfig {
  return { ...authConfig };
}

/**
 * Check if authentication is initialized
 */
export function isAuthInitialized(): boolean {
  return authInitialized;
}

/**
 * Set authentication initialized state
 */
export function setAuthInitialized(initialized: boolean): void {
  authInitialized = initialized;
}

/**
 * Initialize authentication from environment variables (for headless mode)
 */
export async function initializeAuthFromEnv(): Promise<void> {
  // First, load any saved configuration
  loadAuthConfig();

  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const authUsername = process.env.AUTH_USERNAME || 'admin';
  const authPassword = process.env.AUTH_PASSWORD || '';

  // Only override config if environment variables are explicitly set
  if (authEnabled && authPassword) {
    authConfig = {
      enabled: true,
      username: authUsername,
      passwordHash: await hashPassword(authPassword)
    };
    saveAuthConfig(); // Save the new config
  } else if (authEnabled && !authPassword) {
    console.error('[Auth] ERROR: AUTH_ENABLED is true but AUTH_PASSWORD is not set');
  }
}

/**
 * Initialize authentication system
 */
export async function initializeAuth(): Promise<void> {
  try {
    await initializeAuthFromEnv();
    authInitialized = true;
  } catch (error) {
    console.error('[Auth] Failed to initialize authentication:', error);
    authInitialized = true; // Set to true anyway to allow startup, but auth will be disabled
  }
}

// Initialize migration on startup
migrateAuthConfig();