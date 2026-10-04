import * as path from 'path';
import * as fs from 'fs';
import { getDefaultInstallDir, getPlatform } from '../../platform.utils';
import { loadGlobalConfig } from '../../global-config.utils';
import { isProtonInstalled, getProtonBinaryPath, ensureProtonPrefixExists, getProtonPrefixDir } from '../../proton.utils';
import { getInstanceDir } from '../instance.utils';

export const ARK_APP_ID = '2430930';
export const ASA_API_LOADER_EXE = 'AsaApiLoader.exe';
export const ARK_SERVER_EXE = 'ArkAscendedServer.exe';

export interface ResolvedServerLaunch {
  executable: string;
  /** The instance Win64 folder for AsaApi, so its plugins and DLLs resolve. */
  cwd: string;
  usesAsaApiLoader: boolean;
}

/** The shared ARK install, inside the configured Server Data Directory when one is set. */
export function getArkServerDir(): string {
  return path.join(loadGlobalConfig().serverDataDir || getDefaultInstallDir(), 'AASMServer');
}

/** The Windows executable on both platforms: Linux runs it through Proton. */
export function getArkExecutablePath(): string {
  return path.join(getArkServerDir(), 'ShooterGame', 'Binaries', 'Win64', ARK_SERVER_EXE);
}

/** The Z: drive path Wine sees for a Linux path. */
export function toProtonPath(linuxPath: string): string {
  return 'Z:' + linuxPath.replace(/\//g, '\\');
}

/**
 * AsaApi has to be started through AsaApiLoader.exe, which injects the API and then starts the real
 * server with the same arguments.
 */
export function resolveServerLaunch(instanceId: string): ResolvedServerLaunch {
  const instanceWin64 = path.join(getInstanceDir(instanceId), 'ShooterGame', 'Binaries', 'Win64');
  const asaApiLoader = path.join(instanceWin64, ASA_API_LOADER_EXE);
  const instanceExe = path.join(instanceWin64, ARK_SERVER_EXE);
  const sharedExe = getArkExecutablePath();

  if (getPlatform() === 'windows') {
    if (fs.existsSync(asaApiLoader)) {
      return { executable: asaApiLoader, cwd: instanceWin64, usesAsaApiLoader: true };
    }
    if (fs.existsSync(instanceExe)) {
      return { executable: instanceExe, cwd: instanceWin64, usesAsaApiLoader: false };
    }
    return { executable: sharedExe, cwd: path.dirname(sharedExe), usesAsaApiLoader: false };
  }

  // Under Proton the loader is only used when the instance has its own full binary layout.
  if (fs.existsSync(asaApiLoader) && fs.existsSync(instanceExe)) {
    return { executable: asaApiLoader, cwd: getArkServerDir(), usesAsaApiLoader: true };
  }
  return { executable: sharedExe, cwd: getArkServerDir(), usesAsaApiLoader: false };
}

/**
 * The root of the tree ARK runs from for this instance. ARK resolves config, saves, logs and the
 * exclusive-join list against the tree that owns the executable it launched, not the working
 * directory, so every "where will ARK read or write X" question goes through here.
 */
export function getInstanceRuntimeRoot(instanceId: string): string {
  const launch = resolveServerLaunch(instanceId);
  // <root>/ShooterGame/Binaries/Win64/<exe>
  return path.resolve(path.dirname(launch.executable), '..', '..', '..');
}

/** True when the instance runs from its own tree rather than the shared install. */
export function isInstanceIsolated(instanceId: string): boolean {
  return getInstanceRuntimeRoot(instanceId) === getInstanceDir(instanceId);
}

export function getInstanceConfigDir(instanceId: string): string {
  return path.join(getInstanceRuntimeRoot(instanceId), 'ShooterGame', 'Saved', 'Config', 'WindowsServer');
}

export function getInstanceLogsDir(instanceId: string): string {
  return path.join(getInstanceRuntimeRoot(instanceId), 'ShooterGame', 'Saved', 'Logs');
}

/** ARK reads the exclusive-join list from the Win64 folder next to the executable. */
export function getInstanceWhitelistPath(instanceId: string): string {
  return path.join(getInstanceRuntimeRoot(instanceId), 'ShooterGame', 'Binaries', 'Win64', 'PlayersExclusiveJoinList.txt');
}

/**
 * The ?AltSaveDirectoryName= value. ARK appends it to <runtimeRoot>/ShooterGame/Saved/: an isolated
 * instance is already rooted in its own folder, while a shared-install instance needs
 * Servers/<id>/SavedArks to land back in its folder. Either way the worlds stay in the instance's
 * SavedArks.
 */
export function getInstanceAltSaveDirName(instanceId: string): string {
  return isInstanceIsolated(instanceId)
    ? 'SavedArks'
    : path.join('Servers', instanceId, 'SavedArks');
}

/**
 * Command-line text that only this instance's server processes carry, for finding the ones left
 * behind when the tracked launcher exits first. An isolated instance runs an executable inside its
 * own folder; a shared-install instance is told apart by its save directory argument.
 */
export function getInstanceProcessMarker(instanceId: string): string {
  if (isInstanceIsolated(instanceId)) {
    return commandLinePath(getInstanceDir(instanceId)) + '\\';
  }
  return `AltSaveDirectoryName=${getInstanceAltSaveDirName(instanceId)}`;
}

/** Command-line text every server process launched from this app's install carries. */
export function getInstallProcessMarker(): string {
  return commandLinePath(getArkServerDir()) + '\\';
}

// Proton is handed Z: paths, and they are what its processes show on their command lines.
function commandLinePath(dir: string): string {
  const absolute = path.resolve(dir);
  return getPlatform() === 'windows' ? absolute : toProtonPath(absolute);
}

/**
 * Folders ARK resolves against the tree it launches from: real folders for a shared-install
 * instance, junctions onto the shared install for an isolated one. ARK aborts at startup if any is
 * missing or empty.
 */
const REQUIRED_RUNTIME_SUBPATHS = [
  path.join('ShooterGame', 'Content'),
  path.join('ShooterGame', 'Binaries', 'Win64', 'RedpointEOS'),
  'Engine'
];

function hasContents(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory() && fs.readdirSync(dirPath).length > 0;
  } catch {
    // Missing, unreadable, or a junction whose target is gone
    return false;
  }
}

/**
 * Checks that the tree this instance launches from has the folders ARK needs, and whether the
 * shared install is the cause. Call it after the instance structure is prepared: preparation
 * creates the junctions. A junction onto an emptied folder still aborts ARK, so each folder must be
 * non-empty.
 */
export function validateInstanceRuntimeTree(
  instanceId: string
): { valid: boolean; missing: string[]; sharedInstallBroken: boolean } {
  const runtimeRoot = path.resolve(getInstanceRuntimeRoot(instanceId));
  const sharedRoot = path.resolve(getArkServerDir());
  const missing: string[] = [];
  let sharedInstallBroken = false;

  for (const subPath of REQUIRED_RUNTIME_SUBPATHS) {
    // A shared-install instance runs out of sharedRoot, so the failure belongs to the install.
    if (!hasContents(path.join(sharedRoot, subPath))) {
      sharedInstallBroken = true;
      missing.push(subPath);
      continue;
    }
    if (runtimeRoot !== sharedRoot && !hasContents(path.join(runtimeRoot, subPath))) {
      missing.push(subPath);
    }
  }

  return { valid: missing.length === 0, missing, sharedInstallBroken };
}

export function isAsaApiLoaderInstalled(instanceId: string): boolean {
  try {
    return fs.existsSync(path.join(getInstanceDir(instanceId), 'ShooterGame', 'Binaries', 'Win64', ASA_API_LOADER_EXE));
  } catch {
    return false;
  }
}

export interface ArkServerCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** The spawn command for the server: the executable itself on Windows, Proton on Linux. */
export function prepareArkServerCommand(arkExecutable: string, arkArgs: string[], instanceId?: string): ArkServerCommand {
  if (getPlatform() === 'windows') {
    return { command: arkExecutable, args: arkArgs };
  }

  if (!isProtonInstalled()) throw new Error('Proton is required but not installed. Please install Proton first.');
  if (!instanceId) {
    throw new Error('instanceId is required to isolate the Proton prefix on Linux');
  }

  ensureProtonPrefixExists(instanceId);
  const protonBinary = getProtonBinaryPath();
  const prefixDir = getProtonPrefixDir(instanceId);

  // WINEPREFIX and STEAM_COMPAT_DATA_PATH are per instance: a shared prefix causes wineserver lock
  // contention and crashes under load.
  const protonEnv = {
    WINEPREFIX: prefixDir,
    STEAM_COMPAT_DATA_PATH: prefixDir,
    STEAM_COMPAT_CLIENT_INSTALL_PATH: path.join(getDefaultInstallDir(), '.steam'),
    SteamAppId: ARK_APP_ID,
    // SteamGameId lets Proton write a per-game log. UMU_ID makes GE-Proton launch the dedicated
    // server with wine directly; otherwise it starts steam.exe, which exits in a container that has
    // no Steam client and takes the server with it.
    SteamGameId: ARK_APP_ID,
    UMU_ID: ARK_APP_ID,
    // mshtml=d: no IE/HTML components. winhttp/bcrypt/crypt32=n,b: native networking and crypto,
    // which stops the hang during Sentry SDK init in ARK Server v83.21+.
    WINEDLLOVERRIDES: 'mshtml=d;winhttp=n,b;bcrypt=n,b;crypt32=n,b'
  };

  // waitforexitandrun is the verb Steam uses, and protonfixes treats `run` as a unit test. A
  // leading '/' makes GE-Proton run `start.exe /unix`, which returns as soon as the process exists;
  // a Z: path is launched with wine64 and Proton waits until the server exits.
  const protonExe = arkExecutable.startsWith('/') ? toProtonPath(arkExecutable) : arkExecutable;
  const protonArgs = ['waitforexitandrun', protonExe, ...arkArgs];

  // Docker (and any host with a display) keeps a persistent Xvfb. A second xvfb-run display is torn
  // down when Proton's launcher returns, which kills Wine with "X connection to :100 broken" before
  // ShooterGame.log exists.
  if (process.env.DISPLAY) {
    return { command: protonBinary, args: protonArgs, env: protonEnv };
  }

  return {
    command: 'xvfb-run',
    args: ['-a', '--server-args=-screen 0 1024x768x24', protonBinary, ...protonArgs],
    env: protonEnv
  };
}
