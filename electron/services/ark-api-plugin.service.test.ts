import { jest } from '@jest/globals';

// This suite exercises real filesystem behaviour in a temp directory, so it opts out of
// the global fs/path mocks in test/setup.ts, both here and inside the service under test.
jest.unmock('fs');
jest.unmock('path');

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import AdmZip from 'adm-zip';
import { getInstanceDir } from '../utils/ark/instance.utils';
import { ArkApiPluginService } from './ark-api-plugin.service';

jest.mock('../utils/ark/instance.utils', () => ({ getInstanceDir: jest.fn() }));
jest.mock('https', () => ({ get: jest.fn() }));

type Callback = (res: FakeResponse) => void;

interface Reply {
  statusCode: number;
  headers?: Record<string, string>;
  send(res: FakeResponse): void;
}

interface FakeResponse extends PassThrough {
  statusCode: number;
  headers: Record<string, string>;
  complete: boolean;
}

interface FakeRequest extends EventEmitter {
  url: string;
  setTimeout: jest.Mock<(ms: number, onTimeout: () => void) => FakeRequest>;
  destroy: jest.Mock<(error?: Error) => void>;
  onTimeout?: () => void;
}

function response(statusCode: number, headers: Record<string, string> = {}): FakeResponse {
  const res = Object.assign(new PassThrough(), { statusCode, headers, complete: false });
  res.on('end', () => { res.complete = true; });
  return res;
}

function pluginZip(folder: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(`${folder}/plugin.json`, Buffer.from(JSON.stringify({ name: folder, version: '1.0' })));
  return zip.toBuffer();
}

describe('ArkApiPluginService', () => {
  let service: ArkApiPluginService;
  let tmpDir: string;
  let pluginDir: string;
  let requests: FakeRequest[];
  // Each request gets the next of these; one that is missing leaves the request unanswered.
  let replies: Reply[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-api-test-'));
    pluginDir = path.join(tmpDir, 'inst1', 'ShooterGame', 'Binaries', 'Win64', 'ArkApi', 'Plugins');
    jest.mocked(getInstanceDir).mockImplementation(id => path.join(tmpDir, id));
    service = new ArkApiPluginService();

    requests = [];
    replies = [];
    jest.mocked(https.get).mockImplementation(((url: URL, _options: unknown, callback: Callback) => {
      const req = Object.assign(new EventEmitter(), { url: String(url) }) as FakeRequest;
      req.setTimeout = jest.fn((_ms: number, onTimeout: () => void) => { req.onTimeout = onTimeout; return req; });
      req.destroy = jest.fn((error?: Error) => { process.nextTick(() => req.emit('error', error)); });
      requests.push(req);
      const next = replies.shift();
      if (next) {
        process.nextTick(() => {
          const res = response(next.statusCode, next.headers);
          callback(res);
          next.send(res);
        });
      }
      return req;
    }) as unknown as typeof https.get);
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function reply(statusCode: number, headers: Record<string, string> = {}, body?: Buffer): Reply {
    return { statusCode, headers, send: res => res.end(body) };
  }

  describe('listPlugins', () => {
    it('should return empty array when plugin dir does not exist', () => {
      expect(service.listPlugins('inst1')).toEqual([]);
    });

    it('should list plugins from directories', () => {
      const testPlugin = path.join(pluginDir, 'TestPlugin');
      fs.mkdirSync(testPlugin, { recursive: true });
      fs.writeFileSync(
        path.join(testPlugin, 'plugin.json'),
        JSON.stringify({ name: 'Test Plugin', version: '1.0.0', author: 'Tester', description: 'A test' }),
        'utf8'
      );

      const plugins = service.listPlugins('inst1');

      expect(getInstanceDir).toHaveBeenCalledWith('inst1');
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('Test Plugin');
      expect(plugins[0].version).toBe('1.0.0');
      expect(plugins[0].author).toBe('Tester');
      expect(plugins[0].hasPluginJson).toBe(true);
    });

    it('should handle plugins without plugin.json', () => {
      fs.mkdirSync(path.join(pluginDir, 'NoJson'), { recursive: true });

      const plugins = service.listPlugins('inst1');

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('NoJson');
      expect(plugins[0].version).toBe('Unknown');
      expect(plugins[0].hasPluginJson).toBe(false);
    });

    it('should skip non-directory entries', () => {
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(path.join(pluginDir, 'somefile.txt'), 'data', 'utf8');
      fs.mkdirSync(path.join(pluginDir, 'RealPlugin'));

      const plugins = service.listPlugins('inst1');

      expect(plugins).toHaveLength(1);
      expect(plugins[0].folderName).toBe('RealPlugin');
    });

    it('should handle malformed plugin.json', () => {
      const badPlugin = path.join(pluginDir, 'BadPlugin');
      fs.mkdirSync(badPlugin, { recursive: true });
      fs.writeFileSync(path.join(badPlugin, 'plugin.json'), '{invalid json', 'utf8');

      const plugins = service.listPlugins('inst1');

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('BadPlugin');
      expect(plugins[0].version).toBe('Unknown');
    });

    it('should use PluginInfo.json as alternate path', () => {
      const plugin = path.join(pluginDir, 'AltPlugin');
      fs.mkdirSync(plugin, { recursive: true });
      fs.writeFileSync(path.join(plugin, 'PluginInfo.json'), JSON.stringify({ Name: 'Alt Plugin', Version: '2.0' }), 'utf8');

      const plugins = service.listPlugins('inst1');

      expect(plugins[0].name).toBe('Alt Plugin');
      expect(plugins[0].version).toBe('2.0');
    });

    it('refuses an instance id the instance store refuses', () => {
      jest.mocked(getInstanceDir).mockImplementation(() => { throw new Error('Invalid instance ID format'); });

      expect(() => service.listPlugins('../x')).toThrow('Invalid instance ID format');
    });
  });

  describe('removePlugin', () => {
    it('should remove a plugin directory', () => {
      const target = path.join(pluginDir, 'ToRemove');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'data.txt'), 'test', 'utf8');

      service.removePlugin('inst1', 'ToRemove');

      expect(fs.existsSync(target)).toBe(false);
      expect(fs.existsSync(pluginDir)).toBe(true);
    });

    // '.' named the Plugins folder itself and deleted every plugin. Windows drops trailing dots and
    // spaces, so '...' or 'Name.' can do the same there.
    it.each(['.', '..', '...', 'Plugin.', 'Plugin ', '../../../etc', 'a/b', 'a\\b', 'plugin<bad', '', 'nul\u0000'])(
      'refuses the folder name %p and deletes nothing',
      folderName => {
        fs.mkdirSync(path.join(pluginDir, 'Keep'), { recursive: true });

        expect(() => service.removePlugin('inst1', folderName)).toThrow('Invalid plugin folder name');
        expect(fs.existsSync(path.join(pluginDir, 'Keep'))).toBe(true);
      }
    );

    it('should throw when plugin folder does not exist', () => {
      fs.mkdirSync(pluginDir, { recursive: true });

      expect(() => service.removePlugin('inst1', 'NonExistent')).toThrow('not found');
    });
  });

  describe('installPluginFromZipPath', () => {
    it('should throw when zip file does not exist', () => {
      expect(() => service.installPluginFromZipPath('inst1', '/nonexistent.zip')).toThrow('ZIP file not found');
    });

    it('extracts the plugin into the Plugins folder', () => {
      const zipPath = path.join(tmpDir, 'plugin.zip');
      fs.writeFileSync(zipPath, pluginZip('MyPlugin'));

      service.installPluginFromZipPath('inst1', zipPath);

      expect(service.listPlugins('inst1').map(plugin => plugin.name)).toEqual(['MyPlugin']);
    });
  });

  describe('installPluginFromUrl', () => {
    const tempZip = () => path.join(pluginDir, '_plugin_download.zip');

    it('downloads and extracts the plugin, then removes the download', async () => {
      replies.push(reply(200, {}, pluginZip('MyPlugin')));

      await service.installPluginFromUrl('inst1', 'https://example.com/plugin.zip');

      expect(requests.map(req => req.url)).toEqual(['https://example.com/plugin.zip']);
      expect(requests[0].setTimeout).toHaveBeenCalledWith(60_000, expect.any(Function));
      expect(service.listPlugins('inst1').map(plugin => plugin.name)).toEqual(['MyPlugin']);
      expect(fs.existsSync(tempZip())).toBe(false);
    });

    it('follows a relative redirect from the URL that sent it', async () => {
      replies.push(reply(302, { location: '/files/plugin.zip' }), reply(200, {}, pluginZip('MyPlugin')));

      await service.installPluginFromUrl('inst1', 'https://example.com/download?id=1');

      expect(requests.map(req => req.url)).toEqual(['https://example.com/download?id=1', 'https://example.com/files/plugin.zip']);
      expect(service.listPlugins('inst1')).toHaveLength(1);
    });

    it.each(['http://example.com/plugin.zip', 'file:///C:/plugin.zip', 'not a url'])('refuses to download %p', async url => {
      await expect(service.installPluginFromUrl('inst1', url)).rejects.toThrow(/https/);
      expect(https.get).not.toHaveBeenCalled();
    });

    // A redirect to http used to reach https.get inside the response callback, which throws and
    // takes the main process down.
    it('refuses a redirect off https', async () => {
      replies.push(reply(301, { location: 'http://example.com/plugin.zip' }));

      await expect(service.installPluginFromUrl('inst1', 'https://example.com/plugin.zip')).rejects.toThrow(/https/);
      expect(requests).toHaveLength(1);
    });

    it('gives up after five redirects', async () => {
      for (let i = 0; i < 7; i++) replies.push(reply(302, { location: `/hop${i}` }));

      await expect(service.installPluginFromUrl('inst1', 'https://example.com/start')).rejects.toThrow('too many redirects');
      expect(requests).toHaveLength(6);
    });

    it('leaves no file behind when the server answers with an error', async () => {
      replies.push(reply(404, {}, Buffer.from('Not Found')));

      await expect(service.installPluginFromUrl('inst1', 'https://example.com/plugin.zip')).rejects.toThrow('status 404');
      expect(fs.existsSync(tempZip())).toBe(false);
    });

    it('deletes the partial file when the download breaks off', async () => {
      replies.push({
        statusCode: 200,
        send: res => {
          res.write(Buffer.alloc(1024));
          setTimeout(() => res.destroy(new Error('socket hang up')), 10);
        }
      });

      await expect(service.installPluginFromUrl('inst1', 'https://example.com/plugin.zip')).rejects.toThrow('socket hang up');
      expect(fs.existsSync(tempZip())).toBe(false);
    });

    it('gives up on a server that stops answering', async () => {
      const download = service.installPluginFromUrl('inst1', 'https://example.com/plugin.zip');
      await new Promise(resolve => setImmediate(resolve));

      requests[0].onTimeout!();

      await expect(download).rejects.toThrow('timed out');
      expect(requests[0].destroy).toHaveBeenCalled();
    });
  });

  describe('downloadAsaApi', () => {
    it('extracts AsaApi into the instance Win64 folder and removes the download', async () => {
      const zip = new AdmZip();
      zip.addFile('AsaApiLoader.exe', Buffer.from('exe'));
      replies.push(reply(200, {}, zip.toBuffer()));

      await service.downloadAsaApi('inst1', 'https://github.com/AsaApi.zip');

      const win64 = path.join(tmpDir, 'inst1', 'ShooterGame', 'Binaries', 'Win64');
      expect(fs.readdirSync(win64)).toEqual(['AsaApiLoader.exe']);
    });

    it('removes the download when it is not a ZIP', async () => {
      replies.push(reply(200, {}, Buffer.from('<html>rate limited</html>')));

      await expect(service.downloadAsaApi('inst1', 'https://github.com/AsaApi.zip')).rejects.toThrow();
      expect(fs.readdirSync(path.join(tmpDir, 'inst1', 'ShooterGame', 'Binaries', 'Win64'))).toEqual([]);
    });
  });

  describe('getLatestAsaApiRelease', () => {
    it('picks the ZIP asset of the latest release', async () => {
      const release = { tag_name: 'v1.19', assets: [{ name: 'notes.txt' }, { name: 'AsaApi_1.19.zip', browser_download_url: 'https://github.com/a.zip' }] };
      replies.push(reply(200, {}, Buffer.from(JSON.stringify(release))));

      await expect(service.getLatestAsaApiRelease()).resolves.toEqual({
        version: 'v1.19', downloadUrl: 'https://github.com/a.zip', name: 'AsaApi_1.19.zip'
      });
    });

    it('reports GitHub refusing the request', async () => {
      replies.push(reply(403, {}, Buffer.from(JSON.stringify({ message: 'API rate limit exceeded' }))));

      await expect(service.getLatestAsaApiRelease()).rejects.toThrow('GitHub API returned 403');
    });

    it('gives up when GitHub stops answering', async () => {
      const latest = service.getLatestAsaApiRelease();
      await new Promise(resolve => setImmediate(resolve));

      requests[0].onTimeout!();

      await expect(latest).rejects.toThrow('timed out');
    });
  });
});
