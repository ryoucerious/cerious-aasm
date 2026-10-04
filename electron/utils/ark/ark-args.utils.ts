import * as path from 'path';
import { getDefaultInstallDir, getPlatform } from '../platform.utils';
import { parsePort, validateIPAddress } from '../validation.utils';
import type { InstanceConfig } from '../../types/server-instance.types';

type LaunchConfig = Partial<InstanceConfig>;

const DEFAULT_MAP = 'TheIsland_WP';

// A URL option value ends at the next '?', and UE splits the command line on whitespace.
const UNSAFE_URL_VALUE = /[?\s\x00-\x1f\x7f]/;
// Passwords may contain spaces (see below), but never a separator or a control character.
const UNSAFE_PASSWORD = /[?\x00-\x1f\x7f]/;

const isTrue = (value: unknown) => value === true || value === 'true';
const isFalse = (value: unknown) => value === false || value === 'false';

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

/** The configured MultiHome address, or null when none (or a malformed one) is set. */
export function getMultiHomeAddress(config: LaunchConfig): string | null {
  const multiHome = typeof config.multiHome === 'string' ? config.multiHome.trim() : '';
  return multiHome && validateIPAddress(multiHome) ? multiHome : null;
}

function optionalPort(config: LaunchConfig, field: 'gamePort' | 'queryPort'): number | null {
  const value = config[field];
  if (isBlank(value) || value === 0) return null;
  const port = parsePort(value);
  if (port === undefined) {
    console.warn(`[ark-args] Ignoring ${field} "${String(value)}": not a port number`);
    return null;
  }
  return port;
}

function safeValue(value: unknown, field: string): string | null {
  if (isBlank(value)) return null;
  const text = String(value).trim();
  if (UNSAFE_URL_VALUE.test(text)) {
    console.warn(`[ark-args] Ignoring ${field}: it contains '?', whitespace or a control character`);
    return null;
  }
  return text;
}

// A dropped password would leave the server open or without RCON, so refuse to start instead.
function safePassword(value: unknown, label: string): string | null {
  if (isBlank(value)) return null;
  const text = String(value);
  if (UNSAFE_PASSWORD.test(text)) {
    throw new Error(`${label} contains '?' or a control character and cannot be passed to the server. Change it and start again.`);
  }
  return text;
}

/** Command-line arguments for spawn(). The order is part of ARK's contract; do not reshuffle it. */
export function buildArkServerArgs(config: LaunchConfig): string[] {
  const args: string[] = [];

  let mapArg = getArkMapName(config);
  if (UNSAFE_URL_VALUE.test(mapArg)) {
    throw new Error(`Map name "${mapArg}" contains '?', whitespace or a control character. Pick a map and start again.`);
  }
  if (!mapArg.endsWith('_WP')) mapArg += '_WP';

  const paramParts: string[] = ['listen'];

  const gamePort = optionalPort(config, 'gamePort');
  if (gamePort) paramParts.push(`Port=${gamePort}`);

  const altSaveDirName = safeValue(config.altSaveDirName, 'altSaveDirName');
  if (altSaveDirName) paramParts.push(`AltSaveDirectoryName=${altSaveDirName}`);
  // QueryPort is Steam's discovery port (UDP). Each instance needs its own, or only the first
  // server initialises Steam.
  const queryPort = optionalPort(config, 'queryPort');
  if (queryPort) paramParts.push(`QueryPort=${queryPort}`);
  // PeerPort is Steam's authentication port: gamePort + 1, the UE default, not user-configurable.
  if (gamePort && gamePort < 65535) paramParts.push(`PeerPort=${gamePort + 1}`);
  // MultiHome picks the local address the sockets bind to. 0.0.0.0 binds every interface, which a
  // normal LAN/WAN server wants and keeps instances from fighting over one socket. VPN/tunnel users
  // (ZeroTier, WireGuard) bind that interface's address instead. A malformed value never reaches
  // the `?`-delimited URL.
  const multiHome = getMultiHomeAddress(config);
  if (!multiHome && !isBlank(config.multiHome)) {
    console.warn(`[ark-args] Ignoring invalid MultiHome address "${String(config.multiHome).trim()}" - falling back to 0.0.0.0`);
  }
  paramParts.push(`MultiHome=${multiHome ?? '0.0.0.0'}`);

  if (config.clusterDirOverride) {
    // A relative override resolves against the install directory; an absolute one is used as given.
    const clusterDir = path.resolve(getDefaultInstallDir(), config.clusterDirOverride);
    args.push(`-ClusterDirOverride=${clusterDir}`);
  }
  const clusterId = safeValue(config.clusterId, 'clusterId');
  if (clusterId) args.push(`-ClusterId=${clusterId}`);

  // Passwords go in raw, never URL-encoded: ARK does not decode command-line values, so a join
  // password of `my pass!` would arrive as `my%20pass%21` and nobody typing the real one could
  // connect. ServerAdminPassword and the RCON client use the same raw value from config.json.
  const serverPassword = safePassword(config.serverPassword, 'Server password');
  if (serverPassword) paramParts.push(`ServerPassword=${serverPassword}`);

  // PvE goes on the command line so it overrides the INI. It must be 'ServerPVE=True': a bare
  // '?ServerPVE' parses as an empty value (false) and would force the server back to PvP.
  if (isTrue(config.serverPVE) || isTrue(config.bPvE)) paramParts.push('ServerPVE=True');

  // ServerAdminPassword MUST be the last URL option. ARK:SA writes URL options back to
  // GameUserSettings.ini and takes everything after ServerAdminPassword= as the password, e.g.
  // `mypassword?RCONEnabled=True?RCONPort=27020`. RCONEnabled/RCONPort go through the INI instead.
  const adminPassword = safePassword(config.serverAdminPassword || config.rconPassword, 'Admin password');
  if (adminPassword) {
    paramParts.push(`ServerAdminPassword=${adminPassword}`);
  } else {
    console.warn('[ark-args] No admin password configured - RCON will not work');
  }

  args.push(`${mapArg}?${paramParts.join('?')}`);

  if (isFalse(config.battleEye)) args.push('-NoBattlEye');
  if (isTrue(config.useExclusiveList)) args.push('-exclusivejoin');
  // ARK only honours this as a launch flag; it is not a GameUserSettings/Game.ini key.
  if (isTrue(config.forceAllowCaveFlyers)) args.push('-ForceAllowCaveFlyers');

  // Wine/Proton flags ARK Server v83.21+ needs on Linux (disableWineCompatFlags turns them off):
  // NoHangDetection stops UE's hang detector freezing during Sentry SDK init, NOSTEAM keeps the
  // Steam subsystem from hanging the same init (QueryPort discovery still works), and norhithread
  // avoids Wine threading issues in the RHI thread.
  if (getPlatform() === 'linux' && !isTrue(config.disableWineCompatFlags)) {
    args.push('-NoHangDetection');
    args.push('-NOSTEAM');
    args.push('-norhithread');
  }

  if (config.serverPlatform) {
    args.push(`-ServerPlatform=${config.serverPlatform}`);
  } else if (Array.isArray(config.crossplay) && config.crossplay.length > 0) {
    const platformMap: Record<string, string> = {
      'Steam (PC)': 'PC',
      'Xbox (XSX)': 'XSX',
      'PlayStation (PS5)': 'PS5',
      'Windows Store (WINGDK)': 'WINGDK'
    };
    args.push(`-ServerPlatform=${config.crossplay.map(platform => platformMap[platform] || platform).join('+')}`);
  } else {
    args.push('-ServerPlatform=PC');
  }

  // ARK:SA takes its player cap from -WinLiveMaxPlayers; an explicit winLiveMaxPlayers wins.
  const winLiveMaxPlayers = config.winLiveMaxPlayers || config.maxPlayers;
  if (winLiveMaxPlayers) args.push(`-WinLiveMaxPlayers=${winLiveMaxPlayers}`);

  args.push(...getArkLaunchParameters(config));

  if (isTrue(config.noTransferFromFiltering)) args.push('-NoTransferFromFiltering');
  if (isTrue(config.preventDownloadSurvivors)) args.push('-PreventDownloadSurvivors');
  if (isTrue(config.preventDownloadItems)) args.push('-PreventDownloadItems');
  if (isTrue(config.preventDownloadDinos)) args.push('-PreventDownloadDinos');
  if (isTrue(config.preventUploadSurvivors)) args.push('-PreventUploadSurvivors');
  if (isTrue(config.preventUploadItems)) args.push('-PreventUploadItems');
  if (isTrue(config.preventUploadDinos)) args.push('-PreventUploadDinos');

  return args;
}

export function getArkMapName(config: LaunchConfig): string {
  const mapName = typeof config.mapName === 'string' ? config.mapName.trim() : '';
  return mapName || DEFAULT_MAP;
}

/** The enabled mods and any extra launch parameters from the config. */
export function getArkLaunchParameters(config: LaunchConfig): string[] {
  const params: string[] = [];

  let enabledModIds: unknown[] = [];
  if (Array.isArray(config.enabledMods)) {
    enabledModIds = config.enabledMods;
  } else if (Array.isArray(config.mods)) {
    // Older configs hold `{ id, enabled }` objects.
    enabledModIds = config.mods.map(mod =>
      mod && typeof mod === 'object' ? (mod.enabled !== false ? mod.id : null) : mod
    );
  }

  // Hand-edited and imported configs can hold numeric ids.
  const modIds = enabledModIds
    .filter(id => typeof id === 'string' || typeof id === 'number')
    .map(id => String(id).trim())
    .filter(Boolean)
    .join(',');

  if (modIds) {
    // No -automanagedmods: it makes ARK download mods from CurseForge at startup, which fails
    // (serverUnreachable) and stops the server starting. Mods are installed beforehand.
    params.push(`-mods=${modIds}`);
  }

  if (typeof config.launchParameters === 'string') {
    params.push(...config.launchParameters.split(' ').filter(param => param.trim() !== ''));
  }

  return params;
}
