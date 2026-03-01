import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
const AdmZip = require('adm-zip');

const ASAAPI_RELEASES_URL = 'https://api.github.com/repos/ArkServerApi/AsaApi/releases/latest';

export interface PluginInfo {
  name: string;
  version: string;
  author: string;
  description: string;
  folderName: string;
  enabled: boolean;
  hasPluginJson: boolean;
}

export class ArkApiPluginService {

  private getPluginDir(instanceId: string): string {
    const { getInstancesBaseDir } = require('../utils/ark/instance.utils');
    const instanceDir = path.join(getInstancesBaseDir(), instanceId);
    return path.join(instanceDir, 'ShooterGame', 'Binaries', 'Win64', 'ArkApi', 'Plugins');
  }

  /**
   * List all installed plugins for a given server instance.
   */
  listPlugins(instanceId: string): PluginInfo[] {
    const pluginDir = this.getPluginDir(instanceId);
    if (!fs.existsSync(pluginDir)) {
      return [];
    }

    const entries = fs.readdirSync(pluginDir, { withFileTypes: true });
    const plugins: PluginInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderName = entry.name;
      const pluginJsonPath = path.join(pluginDir, folderName, 'plugin.json');
      const altPluginJsonPath = path.join(pluginDir, folderName, 'PluginInfo.json');

      let info: Partial<PluginInfo> = {
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
          // malformed JSON, use defaults
        }
      }

      plugins.push(info as PluginInfo);
    }

    return plugins;
  }

  /**
   * Remove (uninstall) a plugin by folder name.
   */
  removePlugin(instanceId: string, folderName: string): void {
    // Safety: only allow simple folder names (no path traversal)
    if (!folderName || /[/\\<>:"|?*]/.test(folderName)) {
      throw new Error('Invalid plugin folder name.');
    }
    const pluginDir = this.getPluginDir(instanceId);
    const targetDir = path.join(pluginDir, folderName);

    // Ensure resolved path is still inside pluginDir
    const resolved = path.resolve(targetDir);
    if (!resolved.startsWith(path.resolve(pluginDir))) {
      throw new Error('Directory traversal detected.');
    }

    if (!fs.existsSync(targetDir)) {
      throw new Error(`Plugin folder "${folderName}" not found.`);
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  /**
   * Fetch the latest AsaApi release info from GitHub.
   */
  async getLatestAsaApiRelease(): Promise<{ version: string; downloadUrl: string; name: string }> {
    return new Promise((resolve, reject) => {
      const req = https.get(
        ASAAPI_RELEASES_URL,
        { headers: { 'User-Agent': 'Cerious-AASM' } },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              const asset = (json.assets || []).find(
                (a: any) =>
                  a.name.toLowerCase().endsWith('.zip') ||
                  a.name.toLowerCase().includes('asaapi')
              );
              resolve({
                version: json.tag_name || json.name || 'unknown',
                downloadUrl: asset?.browser_download_url || '',
                name: asset?.name || '',
              });
            } catch (e) {
              reject(new Error('Failed to parse GitHub release response.'));
            }
          });
        }
      );
      req.on('error', reject);
    });
  }

  /**
   * Download and extract the AsaApi base into the instance's Win64 folder.
   */
  async downloadAsaApi(instanceId: string, downloadUrl: string): Promise<void> {
    const { getInstancesBaseDir } = require('../utils/ark/instance.utils');
    const instanceDir = path.join(getInstancesBaseDir(), instanceId);
    const win64Dir = path.join(instanceDir, 'ShooterGame', 'Binaries', 'Win64');

    if (!fs.existsSync(win64Dir)) {
      fs.mkdirSync(win64Dir, { recursive: true });
    }

    // Download zip to temp file
    const tempZip = path.join(win64Dir, '_asaapi_download.zip');
    await this.downloadFile(downloadUrl, tempZip);

    // Extract
    const zip = new AdmZip(tempZip);
    zip.extractAllTo(win64Dir, true);

    // Cleanup
    fs.rmSync(tempZip, { force: true });
  }

  /**
   * Install a plugin by extracting a local ZIP file path.
   * The ZIP should contain a single top-level folder (the plugin folder).
   */
  installPluginFromZipPath(instanceId: string, zipPath: string): void {
    const pluginDir = this.getPluginDir(instanceId);
    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true });
    }
    if (!fs.existsSync(zipPath)) {
      throw new Error(`ZIP file not found: ${zipPath}`);
    }
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(pluginDir, true);
  }

  /**
   * Download a plugin ZIP from a URL and extract it into the Plugins directory.
   */
  async installPluginFromUrl(instanceId: string, url: string): Promise<void> {
    const pluginDir = this.getPluginDir(instanceId);
    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true });
    }
    const tempZip = path.join(pluginDir, '_plugin_download.zip');
    await this.downloadFile(url, tempZip);
    try {
      const zip = new AdmZip(tempZip);
      zip.extractAllTo(pluginDir, true);
    } finally {
      fs.rmSync(tempZip, { force: true });
    }
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      const get = (redirectUrl: string) => {
        https.get(redirectUrl, { headers: { 'User-Agent': 'Cerious-AASM' } }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            return get(res.headers.location!);
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed with status ${res.statusCode}`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
          file.on('error', reject);
        }).on('error', reject);
      };
      get(url);
    });
  }
}

export const arkApiPluginService = new ArkApiPluginService();
