import { arkApiPluginService } from './ark-api-plugin.service';
import { isAsaApiLoaderInstalled } from '../utils/ark/ark-server/ark-server-paths.utils';

/** What the ArkApi tab can ask of a server's machine. */
export type ArkApiAction = 'status' | 'list' | 'remove' | 'install-zip' | 'install-url' | 'download-asaapi';

const READ_ONLY: ReadonlySet<string> = new Set<ArkApiAction>(['status', 'list']);

/** Far above any plugin: a cap on what a client can make a machine decode and unpack. */
const MAX_PLUGIN_ZIP_BYTES = 50 * 1024 * 1024;

/** Reads go to another machine as a query; changes as a command, which the mesh logs. */
export function isReadOnlyArkApiAction(action: string): boolean {
  return READ_ONLY.has(action);
}

/**
 * The ArkApi work, on the machine that runs the server: for a server here when the page asks,
 * and for a server here when another machine in the mesh sends the action on.
 */
export async function runArkApiAction(instanceId: string, action: ArkApiAction, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (action) {
    case 'status': {
      const installed = isAsaApiLoaderInstalled(instanceId);
      return { success: true, installed, loaderExe: installed ? 'AsaApiLoader.exe' : null };
    }
    case 'list':
      return { success: true, plugins: arkApiPluginService.listPlugins(instanceId) };
    case 'remove': {
      const folderName = String(args.folderName ?? '');
      arkApiPluginService.removePlugin(instanceId, folderName);
      return { success: true, folderName };
    }
    case 'install-zip': {
      const zipData = String(args.zipData ?? '');
      if ((zipData.length * 3) / 4 > MAX_PLUGIN_ZIP_BYTES) return { success: false, error: 'That ZIP is larger than 50 MB.' };
      arkApiPluginService.installPluginFromZipData(instanceId, zipData);
      return { success: true };
    }
    case 'install-url':
      await arkApiPluginService.installPluginFromUrl(instanceId, String(args.url ?? ''));
      return { success: true };
    case 'download-asaapi':
      await arkApiPluginService.downloadAsaApi(instanceId, String(args.downloadUrl ?? ''));
      return { success: true };
    default:
      throw new Error(`Unknown ArkApi action: ${String(action)}`);
  }
}
