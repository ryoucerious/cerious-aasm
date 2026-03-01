import * as fs from 'fs';
import * as path from 'path';
import { getDefaultInstallDir } from '../platform.utils';

let uuidv4: (() => string) | null = null;

// Fallback UUID generator for when the uuid package fails
function generateFallbackUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function getUuidV4() {
  if (!uuidv4) {
    try {
      // Try multiple import methods for better packaged app compatibility
      let mod;
      try {
        mod = await import('uuid');
      } catch (error) {
        mod = require('uuid');
      }
      
      uuidv4 = mod.v4 || mod.default?.v4 || generateFallbackUuid;
    } catch (error) {
      // If all imports fail, use fallback
      uuidv4 = generateFallbackUuid;
    }
  }
  return uuidv4;
}

// Validate instance ID to prevent directory traversal and ensure proper format
function validateInstanceId(id: string): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }
  
  // Allow only alphanumeric characters, hyphens, and underscores
  // This prevents directory traversal attempts like "../" or "../../"
  const validIdPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validIdPattern.test(id)) {
    return false;
  }
  
  // Additional length check
  if (id.length > 50) {
    return false;
  }
  
  return true;
}


export function getInstancesBaseDir() {
  // Use config if available, otherwise default
  try {
     const { loadGlobalConfig } = require('../global-config.utils');
     const config = loadGlobalConfig();
     if (config.serverDataDir) {
       return path.join(config.serverDataDir, 'AASMServer', 'ShooterGame', 'Saved', 'Servers');
     }
  } catch (e) {
    // Ignore error loading config (circular dependency or file not found), fall back to default
  }

  const installDir = getDefaultInstallDir();
  if (!installDir) {
    throw new Error('Could not determine install directory');
  }
  return path.join(installDir, 'AASMServer', 'ShooterGame', 'Saved', 'Servers');
}

// For compatibility with previous code, alias getDefaultInstancesBaseDir
export function getDefaultInstancesBaseDir() {
  return getInstancesBaseDir();
}

const getInstanceConfigPath = (id: string) => {
  if (!validateInstanceId(id)) {
    throw new Error(`Invalid instance ID format: ${id}`);
  }
  return path.join(getInstancesBaseDir(), id, 'config.json');
};

export async function getAllInstances() {
  const baseDir = getInstancesBaseDir();
  let justCreated = false;
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
    justCreated = true;
  }
  let instances = fs.readdirSync(baseDir)
    .filter(id => fs.existsSync(getInstanceConfigPath(id)))
    .map(id => {
      try {
        const config = JSON.parse(fs.readFileSync(getInstanceConfigPath(id), 'utf8'));
        return { id, ...config };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // Sort by sortOrder so Start All / other bulk operations respect the user-defined order
  instances = instances.sort((a: any, b: any) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));

  // No default creation here; frontend is responsible for creating a default if needed
  return instances;
}

export function getInstance(id: string) {
  if (!id || typeof id !== 'string') {
    console.warn('[server-instance-utils] getInstance called with invalid id:', id);
    return null;
  }
  
  const configPath = getInstanceConfigPath(id);
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export async function saveInstance(instance: any) {
  // Check for duplicate name (case-insensitive)
  const all = await getAllInstances();
  const name = (instance.name || '').trim().toLowerCase();
  if (all.some(inst => inst.name && inst.name.trim().toLowerCase() === name && inst.id !== instance.id)) {
    // Duplicate name found
    return { error: 'A server with this name already exists.' };
  }
  const uuidGenerator = await getUuidV4();
  const id = instance.id || (uuidGenerator ? uuidGenerator() : generateFallbackUuid());
  const dir = path.join(getInstancesBaseDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  // Always include the id in the config.json
  const instanceWithId = { ...instance, id };
  fs.writeFileSync(getInstanceConfigPath(id), JSON.stringify(instanceWithId, null, 2));
  return { ...instanceWithId };
}

export function deleteInstance(id: string) {
  const dir = path.join(getInstancesBaseDir(), id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }
  return false;
}

/**
 * Sets up instance directories and loads configuration
 */
export function loadInstanceConfig(instanceId: string): { instanceDir: string, config: any } {
  const baseDir = getDefaultInstancesBaseDir?.() || getInstancesBaseDir?.();
  if (!baseDir) {
    throw new Error('Instance folder missing');
  }

  const instanceDir = path.join(baseDir, instanceId);

  // Load instance config
  let config: any = {};
  const configPath = path.join(instanceDir, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('[ark-server-utils] Failed to load instance config:', e);
  }

  return { instanceDir, config };
}

export function getInstanceSaveDir(instanceDir: string): string {
  return path.join(instanceDir, 'SavedArks');
}

// Inline exports declared above
