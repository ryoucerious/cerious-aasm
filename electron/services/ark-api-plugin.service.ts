import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import type { IncomingMessage } from 'http';
import AdmZip from 'adm-zip';
import { getInstanceDir } from '../utils/ark/instance.utils';

const ASAAPI_RELEASES_URL = 'https://api.github.com/repos/ArkServerApi/AsaApi/releases/latest';
const USER_AGENT = 'Cerious-AASM';
const MAX_REDIRECTS = 5;
// Socket inactivity, not total time: a large download on a slow link is fine while bytes arrive.
const SOCKET_TIMEOUT_MS = 60_000;

// Separators and characters Windows forbids. A trailing dot or space is dropped by Windows, so
// "..." or "Plugin." would name the Plugins folder itself or another plugin.
const UNSAFE_FOLDER_NAME = /[<>:"/\\|?*\x00-\x1f]|[. ]$/;

export interface PluginInfo {
  name: string;
  version: string;
  author: string;
  description: string;
  folderName: string;
  enabled: boolean;
  hasPluginJson: boolean;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  assets?: { name?: string; browser_download_url?: string }[];
}

export class ArkApiPluginService {
  private getWin64Dir(instanceId: string): string {
    return path.join(getInstanceDir(instanceId), 'ShooterGame', 'Binaries', 'Win64');
  }

  private getPluginDir(instanceId: string): string {
    return path.join(this.getWin64Dir(instanceId), 'ArkApi', 'Plugins');
  }

  listPlugins(instanceId: string): PluginInfo[] {
    const pluginDir = this.getPluginDir(instanceId);
    if (!fs.existsSync(pluginDir)) {
      return [];
    }

    const plugins: PluginInfo[] = [];
    for (const entry of fs.readdirSync(pluginDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const folderName = entry.name;
      const pluginJsonPath = path.join(pluginDir, folderName, 'plugin.json');
      const altPluginJsonPath = path.join(pluginDir, folderName, 'PluginInfo.json');

      let info: PluginInfo = {
        name: folderName,
        version: 'Unknown',
        author: 'Unknown',
        description: '',
        folderName,
        enabled: true,
        hasPluginJson: false,
      };

      const jsonPath = fs.existsSync(pluginJsonPath) ? pluginJsonPath : fs.existsSync(altPluginJsonPath) ? altPluginJsonPath : null;
      if (jsonPath) {
        try {
          const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          info = {
            ...info,
            name: parsed.name || parsed.Name || folderName,
            version: parsed.version || parsed.Version || 'Unknown',
            author: parsed.author || parsed.Author || 'Unknown',
            description: parsed.description || parsed.Description || '',
            hasPluginJson: true,
          };
        } catch {
          // A malformed plugin.json still lists the plugin, under its folder name.
        }
      }

      plugins.push(info);
    }

    return plugins;
  }

  /** Deletes one plugin folder. Throws for anything but the name of a folder directly in Plugins. */
  removePlugin(instanceId: string, folderName: string): void {
    const pluginDir = path.resolve(this.getPluginDir(instanceId));
    if (typeof folderName !== 'string' || !folderName || UNSAFE_FOLDER_NAME.test(folderName)) {
      throw new Error('Invalid plugin folder name.');
    }
    const targetDir = path.resolve(pluginDir, folderName);
    if (path.dirname(targetDir) !== pluginDir) {
      throw new Error('Invalid plugin folder name.');
    }

    if (!fs.existsSync(targetDir)) {
      throw new Error(`Plugin folder "${folderName}" not found.`);
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  getLatestAsaApiRelease(): Promise<{ version: string; downloadUrl: string; name: string }> {
    return new Promise((resolve, reject) => {
      const request = https.get(new URL(ASAAPI_RELEASES_URL), { headers: { 'User-Agent': USER_AGENT } }, res => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GitHub API returned ${res.statusCode}`));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('error', reject);
        res.on('end', () => {
          try {
            const release: GitHubRelease = JSON.parse(data);
            const asset = (release.assets || []).find(a => {
              const name = (a.name || '').toLowerCase();
              return name.endsWith('.zip') || name.includes('asaapi');
            });
            resolve({
              version: release.tag_name || release.name || 'unknown',
              downloadUrl: asset?.browser_download_url || '',
              name: asset?.name || '',
            });
          } catch {
            reject(new Error('Failed to parse GitHub release response.'));
          }
        });
      });
      request.setTimeout(SOCKET_TIMEOUT_MS, () => request.destroy(new Error('The GitHub request timed out')));
      request.on('error', reject);
    });
  }

  /** Downloads the AsaApi release ZIP and extracts it into the instance's Win64 folder. */
  async downloadAsaApi(instanceId: string, downloadUrl: string): Promise<void> {
    const win64Dir = this.getWin64Dir(instanceId);
    fs.mkdirSync(win64Dir, { recursive: true });
    await this.downloadAndExtract(downloadUrl, path.join(win64Dir, '_asaapi_download.zip'), win64Dir);
  }

  /** The ZIP should hold one top-level folder: the plugin. */
  installPluginFromZipPath(instanceId: string, zipPath: string): void {
    const pluginDir = this.getPluginDir(instanceId);
    if (!fs.existsSync(zipPath)) {
      throw new Error(`ZIP file not found: ${zipPath}`);
    }
    fs.mkdirSync(pluginDir, { recursive: true });
    new AdmZip(zipPath).extractAllTo(pluginDir, true);
  }

  async installPluginFromUrl(instanceId: string, url: string): Promise<void> {
    const pluginDir = this.getPluginDir(instanceId);
    fs.mkdirSync(pluginDir, { recursive: true });
    await this.downloadAndExtract(url, path.join(pluginDir, '_plugin_download.zip'), pluginDir);
  }

  private async downloadAndExtract(url: string, zipPath: string, targetDir: string): Promise<void> {
    await this.downloadFile(url, zipPath);
    try {
      new AdmZip(zipPath).extractAllTo(targetDir, true);
    } finally {
      fs.rmSync(zipPath, { force: true });
    }
  }

  /**
   * Streams an https URL to `dest`, following up to five redirects. Rejects on any other status,
   * a hop off https, or a stalled socket, and never leaves a partial file behind.
   */
  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let file: fs.WriteStream | null = null;
      let failure: Error | null = null;

      const fail = (error: Error) => {
        if (settled || failure) return;
        failure = error;
        if (file) {
          // Unlinked once the stream has released the file; see its 'close' handler.
          file.destroy();
        } else {
          settled = true;
          reject(error);
        }
      };

      const save = (res: IncomingMessage) => {
        file = fs.createWriteStream(dest);
        file.on('error', fail);
        file.on('close', () => {
          settled = true;
          if (failure) {
            const error = failure;
            fs.unlink(dest, () => reject(error));
          } else {
            resolve();
          }
        });
        res.on('error', fail);
        res.on('aborted', () => fail(new Error('The download was interrupted')));
        res.pipe(file);
      };

      const get = (target: URL, redirectsLeft: number) => {
        if (target.protocol !== 'https:') {
          fail(new Error(`Only https downloads are allowed, not ${target.protocol}`));
          return;
        }
        const request = https.get(target, { headers: { 'User-Agent': USER_AGENT } }, res => {
          // Nothing thrown in here may escape: it would be an uncaught exception in main.
          try {
            if (failure) {
              res.resume();
              return;
            }
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400 && res.headers.location) {
              res.resume();
              if (redirectsLeft === 0) {
                fail(new Error('Download failed: too many redirects'));
                return;
              }
              get(new URL(res.headers.location, target), redirectsLeft - 1);
              return;
            }
            if (status !== 200) {
              res.resume();
              fail(new Error(`Download failed with status ${status}`));
              return;
            }
            save(res);
          } catch (error) {
            res.resume();
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        });
        request.setTimeout(SOCKET_TIMEOUT_MS, () => request.destroy(new Error('Download timed out')));
        request.on('error', fail);
      };

      let start: URL;
      try {
        start = new URL(url);
      } catch {
        fail(new Error('The download URL is not a valid https URL'));
        return;
      }
      get(start, MAX_REDIRECTS);
    });
  }
}

export const arkApiPluginService = new ArkApiPluginService();
