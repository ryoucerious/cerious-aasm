// plugin-view.utils.ts
// On Linux every server starts the shared AsaApi loader, which reads plugins from
// the one folder next to that loader. Wrap the launch so that folder is this
// server's own plugin directory and no other server is affected.

import * as fs from 'fs';
import * as path from 'path';
import { getPlatform } from '../../platform.utils';

const PLUGIN_TAIL = ['ShooterGame', 'Binaries', 'Win64', 'ArkApi', 'Plugins'];
const INSTANCE_CONFIG_TAIL = ['Config', 'WindowsServer'];
const SHARED_CONFIG_TAIL = ['ShooterGame', 'Saved', 'Config', 'WindowsServer'];
const HELPER_NAME = 'aasm-plugin-view';

export function instancePluginDir(instanceId: string): string {
  const { getInstancesBaseDir } = require('../../ark/instance.utils');
  return path.join(getInstancesBaseDir(), instanceId, ...PLUGIN_TAIL);
}

export function sharedPluginDir(): string {
  const { getArkServerDir } = require('./ark-server-install.utils');
  return path.join(getArkServerDir(), ...PLUGIN_TAIL);
}

export function instanceConfigDir(instanceId: string): string {
  const { getInstancesBaseDir } = require('../../ark/instance.utils');
  return path.join(getInstancesBaseDir(), instanceId, ...INSTANCE_CONFIG_TAIL);
}

export function sharedConfigDir(): string {
  const { getArkServerDir } = require('./ark-server-install.utils');
  return path.join(getArkServerDir(), ...SHARED_CONFIG_TAIL);
}

/** Helper installed on the host with permission to make a private mount. */
export function resolvePluginViewHelper(): string | null {
  const candidates = ['/usr/local/bin/' + HELPER_NAME];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, HELPER_NAME));
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Unreadable candidate. Try the next one.
    }
  }
  return null;
}

/**
 * Prefix the launch command with the plugin-view helper when this server is using
 * the shared loader. An empty instance plugin directory is valid: that server
 * then starts with the loader and no plugins.
 */
export function withInstancePlugins(
  command: string,
  args: string[],
  instanceId: string,
  usesSharedLoader: boolean
): { command: string; args: string[] } {
  if (getPlatform() !== 'linux' || !usesSharedLoader) return { command, args };

  const helper = resolvePluginViewHelper();
  if (!helper) {
    console.warn('[plugins] aasm-plugin-view is not installed; this server will see the shared plugin folder');
    return { command, args };
  }

  const bindings = [
    [instancePluginDir(instanceId), sharedPluginDir()],
    [instanceConfigDir(instanceId), sharedConfigDir()]
  ];
  const helperArgs: string[] = [];
  for (const [source, target] of bindings) {
    fs.mkdirSync(source, { recursive: true });
    helperArgs.push('--bind', source, target);
  }
  console.log(`[plugins] ${instanceId} plugins and ini from its own folders`);
  return { command: helper, args: [...helperArgs, '--', command, ...args] };
}
