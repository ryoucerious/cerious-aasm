// --- Imports ---
import * as path from 'path';
import { getDefaultInstallDir, getPlatform } from '../platform.utils';

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

  if (config.gamePort) paramParts.push(`Port=${config.gamePort}`);

  if (config.altSaveDirName) paramParts.push(`AltSaveDirectoryName=${config.altSaveDirName}`);
  // QueryPort is the Steam server discovery/query port (UDP).
  // Each instance MUST have a unique QueryPort or only the first server initialises Steam.
  if (config.queryPort) paramParts.push(`QueryPort=${config.queryPort}`);
  // PeerPort is the Steam Online Subsystem authentication port.
  // Auto-calculated as gamePort + 1 (UE default) — not user-configurable.
  const peerPort = config.gamePort ? parseInt(config.gamePort, 10) + 1 : null;
  if (peerPort) paramParts.push(`PeerPort=${peerPort}`);
  // MultiHome ensures each instance properly binds its own sockets
  paramParts.push('MultiHome=0.0.0.0');

  // Cluster parameters
  if (config.clusterDirOverride) {
    // Resolve cluster directory relative to the installation directory
    // This prevents users from accessing directories outside the app scope
    const installDir = getDefaultInstallDir();
    const clusterDir = path.resolve(installDir, config.clusterDirOverride);
    args.push(`-ClusterDirOverride=${clusterDir}`);
  }
  if (config.clusterId) args.push(`-ClusterId=${config.clusterId}`);

  // Passwords — URL-encode to handle special characters in query strings.
  // RCON client will use the unencoded value from config, but ARK receives the
  // URL-encoded version in the command line and decodes it internally.
  if (config.serverPassword) paramParts.push(`ServerPassword=${encodeURIComponent(config.serverPassword)}`);

  // PvE mode - pass on command line so it overrides INI (avoids shared config dir race)
  const toBool = (val: any) => val === true || val === 'true';
  // Must be 'ServerPVE=True' — a bare '?ServerPVE' parses as an empty value (false)
  // and, because this overrides the INI, would force the server back to PVP.
  if (toBool(config.serverPVE) || toBool(config.bPvE)) paramParts.push('ServerPVE=True');

  // ServerAdminPassword MUST be the LAST URL param.
  // ARK:SA (UE5) has a known bug where it writes command-line URL params back to
  // GameUserSettings.ini and treats everything AFTER ServerAdminPassword= up to the
  // end of the param string as the password value.  Placing it last means nothing
  // follows it, preventing concatenation such as:
  //   ServerAdminPassword=mypassword?RCONEnabled=True?RCONPort=27020
  // RCONEnabled and RCONPort are written to GameUserSettings.ini by writeArkConfigFiles
  // and do NOT need to appear in the URL params.
  const adminPassword = config.serverAdminPassword || config.rconPassword;
  if (adminPassword) {
    console.log(`[ark-args] Setting ServerAdminPassword for RCON (length: ${String(adminPassword).length})`);
    paramParts.push(`ServerAdminPassword=${adminPassword}`);
  } else {
    console.warn(`[ark-args] No admin password configured - RCON will not work!`);
  }

  // Compose the main command string
  let mainArg = mapArg;
  if (paramParts.length > 0) {
    mainArg += '?' + paramParts.join('?');
  }

  args.push(mainArg);

  const isTrue = (val: any) => val === true || val === 'true';
  const isFalse = (val: any) => val === false || val === 'false';

  // Add standard flags
  if (isFalse(config.battleEye)) args.push('-NoBattlEye');
  if (isTrue(config.useExclusiveList)) args.push('-exclusivejoin');
  
  // Wine/Proton compatibility flags (required for ARK Server v83.21+ on Linux)
  // These Unreal Engine flags prevent crashes and hangs when running under Wine:
  // - NoHangDetection: Disables UE hang detection that freezes during Sentry SDK init
  // - NOSTEAM: Disables Steam API subsystem (prevents Sentry initialization hang)
  // - norhithread: Disables RHI rendering thread (prevents Wine threading issues)
  // Note: Server will still be discoverable via QueryPort and show in Steam server browser
  // Can be disabled via disableWineCompatFlags config option if issues arise
  if (getPlatform() === 'linux' && !isTrue(config.disableWineCompatFlags)) {
    args.push('-NoHangDetection');
    args.push('-NOSTEAM');
    args.push('-norhithread');
  }

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

  // MaxPlayers — ARK:SA uses -WinLiveMaxPlayers=N as the authoritative player cap flag.
  // winLiveMaxPlayers takes explicit precedence; otherwise maxPlayers drives the value.
  const winLiveMaxPlayers = config.winLiveMaxPlayers || config.maxPlayers;
  if (winLiveMaxPlayers) args.push(`-WinLiveMaxPlayers=${winLiveMaxPlayers}`);

  // Add launch parameters from INI utils (handles mods, crossplay, maxPlayers, etc.)
  const launchParams = getArkLaunchParameters(config);
  args.push(...launchParams);

  // Cluster flags (legacy support - these might be better handled in INI)
  if (isTrue(config.noTransferFromFiltering)) args.push('-NoTransferFromFiltering');
  if (isTrue(config.preventDownloadSurvivors)) args.push('-PreventDownloadSurvivors');
  if (isTrue(config.preventDownloadItems)) args.push('-PreventDownloadItems');
  if (isTrue(config.preventDownloadDinos)) args.push('-PreventDownloadDinos');
  if (isTrue(config.preventUploadSurvivors)) args.push('-PreventUploadSurvivors');
  if (isTrue(config.preventUploadItems)) args.push('-PreventUploadItems');
  if (isTrue(config.preventUploadDinos)) args.push('-PreventUploadDinos');

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
    // Do NOT pass -automanagedmods: it tells ARK to download mods from CurseForge at
    // startup, which fails (serverUnreachable) and prevents the server from starting.
    // Mods are pre-installed via SteamCMD; -mods= alone is sufficient to load them.
  }

  // Add any additional launch parameters from config
  if (config.launchParameters) {
    const additionalParams = config.launchParameters.split(' ').filter((param: string) => param.trim() !== '');
    params.push(...additionalParams);
  }

	return params;
}

