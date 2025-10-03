// --- Imports ---
import * as path from 'path';
import { getDefaultInstallDir } from '../platform.utils';

// --- ARK Server Argument Building ---

/**
 * Build Ark Ascended server command line arguments from instance config.
 * Returns an array of args for spawn().
 */
export function buildArkServerArgs(config: any): string[] {
  const args: string[] = [];

  // Map (required, always ends with _WP)
  let mapArg = getArkMapName(config);
  if (!mapArg.endsWith('_WP')) mapArg += '_WP';

  // Build query parameters that go after the map name
  let paramParts: string[] = [];
  paramParts.push('listen');

  // Session name - this can be in both command line and INI, command line takes precedence
  if (config.sessionName) paramParts.push(`SessionName=${config.sessionName}`);
  if (config.gamePort) paramParts.push(`Port=${config.gamePort}`);
  if (config.queryPort) paramParts.push(`QueryPort=${config.queryPort}`);
  if (config.altSaveDirectoryName) paramParts.push(`AltSaveDirectoryName=${config.altSaveDirectoryName}`);

  // Cluster parameters
  if (config.clusterDirOverride) {
    // Resolve cluster directory relative to the installation directory
    // This prevents users from accessing directories outside the app scope
    const installDir = getDefaultInstallDir();
    const clusterDir = path.resolve(installDir, config.clusterDirOverride);
    args.push(`-ClusterDirOverride=${clusterDir}`);
  }
  if (config.clusterId) args.push(`-ClusterId=${config.clusterId}`);

  // Passwords - these will also be in INI files
  if (config.serverPassword) paramParts.push(`ServerPassword=${config.serverPassword}`);
  if (config.serverAdminPassword) paramParts.push(`RCONPassword=${config.serverAdminPassword}`);

  // Always enable RCON if we have a port
  if (config.rconPort) {
    paramParts.push('RCONEnabled=True');
    paramParts.push(`RCONPort=${config.rconPort}`);
    if (config.rconPassword) {
      paramParts.push(`ServerAdminPassword=${config.rconPassword}`);
    }
  }

  // Compose the main command string
  let mainArg = mapArg;
  if (paramParts.length > 0) {
    mainArg += '?' + paramParts.join('?');
  }

  args.push(mainArg);

  // Add standard flags
  if (config.battleEye === false) args.push('-NoBattlEye');
  if (config.useExclusiveList) args.push('-exclusivejoin');

  // Server platform - convert crossplay array if serverPlatform not set
  if (config.serverPlatform) {
    args.push(`-ServerPlatform=${config.serverPlatform}`);
  } else if (config.crossplay && Array.isArray(config.crossplay) && config.crossplay.length > 0) {
    // Convert crossplay platforms to serverPlatform format
    const platformMap: { [key: string]: string } = {
      'Steam (PC)': 'PC',
      'Xbox (XSX)': 'XSX',
      'PlayStation (PS5)': 'PS5',
      'Windows Store (WINGDK)': 'WINGDK'
    };
    const platforms = config.crossplay.map((p: string) => platformMap[p] || p).join('+');
    args.push(`-ServerPlatform=${platforms}`);
  } else {
    args.push('-ServerPlatform=PC');
  }

  // Add launch parameters from INI utils (handles mods, crossplay, maxPlayers, etc.)
  const launchParams = getArkLaunchParameters(config);
  args.push(...launchParams);

  // Cluster flags (legacy support - these might be better handled in INI)
  if (config.noTransferFromFiltering) args.push('-NoTransferFromFiltering');
  if (config.preventDownloadSurvivors) args.push('-PreventDownloadSurvivors');
  if (config.preventDownloadItems) args.push('-PreventDownloadItems');
  if (config.preventDownloadDinos) args.push('-PreventDownloadDinos');
  if (config.preventUploadSurvivors) args.push('-PreventUploadSurvivors');
  if (config.preventUploadItems) args.push('-PreventUploadItems');
  if (config.preventUploadDinos) args.push('-PreventUploadDinos');

  return args;

}



/**
 * Get ARK map name from config
 * @param config - Configuration object
 * @returns ARK map name
 */
export function getArkMapName(config: any): string {
  return config.mapName || 'TheIsland_WP';
}

/**
 * Get ARK launch parameters from config
 * @param config - Configuration object
 * @returns Array of launch parameters
 */
export function getArkLaunchParameters(config: any): string[] {
  const params: string[] = [];

  // Convert mods array to launch parameters (only include enabled mods)
  let enabledModIds: string[] = [];
  if (config.enabledMods && Array.isArray(config.enabledMods)) {
    enabledModIds = config.enabledMods;
  } else if (config.mods && Array.isArray(config.mods) && config.mods.length > 0) {
    // Legacy format: mods array contains objects with {id, enabled}
    const firstMod = config.mods[0];
    if (firstMod && typeof firstMod === 'object' && firstMod.id) {
      // Legacy format: filter enabled mods
      enabledModIds = config.mods
        .filter((mod: any) => mod && mod.enabled !== false)
        .map((mod: any) => mod.id);
    } else {
      // Assume all string IDs are enabled (fallback)
      enabledModIds = config.mods.filter((modId: any) => typeof modId === 'string' && modId.trim());
    }
  }

  const modIds = enabledModIds
    .map((modId: string) => modId.trim())
    .filter((id: string) => id)
    .join(',');

  if (modIds) {
    params.push(`-mods=${modIds}`);
    params.push('-automanagedmods');
  }

  // Add any additional launch parameters from config
  if (config.launchParameters) {
    const additionalParams = config.launchParameters.split(' ').filter((param: string) => param.trim() !== '');
    params.push(...additionalParams);
  }

	return params;
}

