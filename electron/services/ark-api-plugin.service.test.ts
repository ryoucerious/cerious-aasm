import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('../utils/ark/instance.utils', () => ({
  getInstancesBaseDir: jest.fn(() => '/mock/instances'),
}));

describe('ArkApiPluginService', () => {
  let ArkApiPluginService: any;
  let service: any;
  let tmpDir: string;

  beforeAll(() => {
    const mod = require('./ark-api-plugin.service');
    ArkApiPluginService = mod.ArkApiPluginService;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-api-test-'));
    service = new ArkApiPluginService();

    // Override getInstancesBaseDir for real filesystem tests
    const instanceUtils = require('../utils/ark/instance.utils');
    (instanceUtils.getInstancesBaseDir as jest.Mock).mockReturnValue(tmpDir);
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('listPlugins', () => {
    it('should return empty array when plugin dir does not exist', () => {
      const plugins = service.listPlugins('inst1');
      expect(plugins).toEqual([]);
    });

    it('should list plugins from directories', () => {
      const pluginDir = path.join(tmpDir, 'inst1', 'ShooterGame', 'Binaries', 'Win64', 'ArkApi', 'Plugins');
      const testPlugin = path.join(pluginDir, 'TestPlugin');
      fs.mkdirSync(testPlugin, { recursive: true });

      // Create a plugin.json
      fs.writeFileSync(
        path.join(testPlugin, 'plugin.json'),
        JSON.stringify({ name: 'Test Plugin', version: '1.0.0', author: 'Tester', description: 'A test' }),
        'utf8'
      );

      const plugins = service.listPlugins('inst1');

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('Test Plugin');
      expect(plugins[0].version).toBe('1.0.0');
      expect(plugins[0].author).toBe('Tester');
      expect(plugins[0].hasPluginJson).toBe(true);
    });

    it('should handle plugins without plugin.json', () => {
      const pluginDir = path.join(tmpDir, 'inst1', 'ShooterGame', 'Binaries', 'Win64', 'ArkApi', 'Plugins');
      fs.mkdirSync(path.join(pluginDir, 'NoJson'), { recursive: true });

      const plugins = service.listPlugins('inst1');

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('NoJson');
      expect(plugins[0].version).toBe('Unknown');
      expect(plugins[0].hasPluginJson).toBe(false);
    });

    it('should skip non-directory entries', () => {
      const pluginDir = path.join(tmpDir, 'inst1', 'ShooterGame', 'Binaries', 'Win64', 'ArkApi', 'Plugins');
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(path.join(pluginDir, 'somefile.txt'), 'data', 'utf8');
      fs.mkdirSync(path.join(pluginDir, 'RealPlugin'));

      const plugins = service.listPlugins('inst1');

      expect(plugins).toHaveLength(1);
      expect(plugins[0].folderName).toBe('RealPlugin');
    });

    it('should handle malformed plugin.json', () => {
      const pluginDir = path.join(tmpDir, 'inst1', 'ShooterGame', 'Binaries', 'Win64', 'ArkApi', 'Plugins');
      const badPlugin = path.join(pluginDir, 'BadPlugin');
      fs.mkdirSync(badPlugin, { recursive: true });
      fs.writeFileSync(path.join(badPlugin, 'plugin.json'), '{invalid json', 'utf8');

      const plugins = service.listPlugins('inst1');

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('BadPlugin');
      expect(plugins[0].version).toBe('Unknown');
    });

    it('should use PluginInfo.json as alternate path', () => {
      const pluginDir = path.join(tmpDir, 'inst1', 'ShooterGame', 'Binaries', 'Win64', 'ArkApi', 'Plugins');
      const plugin = path.join(pluginDir, 'AltPlugin');
      fs.mkdirSync(plugin, { recursive: true });
      fs.writeFileSync(
        path.join(plugin, 'PluginInfo.json'),
        JSON.stringify({ Name: 'Alt Plugin', Version: '2.0' }),
        'utf8'
      );

      const plugins = service.listPlugins('inst1');

      expect(plugins[0].name).toBe('Alt Plugin');
      expect(plugins[0].version).toBe('2.0');
    });
  });

  describe('removePlugin', () => {
    it('should remove a plugin directory', () => {
      const pluginDir = path.join(tmpDir, 'inst1', 'ShooterGame', 'Binaries', 'Win64', 'ArkApi', 'Plugins');
      const target = path.join(pluginDir, 'ToRemove');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'data.txt'), 'test', 'utf8');

      service.removePlugin('inst1', 'ToRemove');

      expect(fs.existsSync(target)).toBe(false);
    });

    it('should throw on invalid folder name with path traversal', () => {
      expect(() => service.removePlugin('inst1', '../../../etc')).toThrow('Invalid plugin folder name');
    });

    it('should throw on folder name with special characters', () => {
      expect(() => service.removePlugin('inst1', 'plugin<bad')).toThrow('Invalid plugin folder name');
    });

    it('should throw on empty folder name', () => {
      expect(() => service.removePlugin('inst1', '')).toThrow('Invalid plugin folder name');
    });

    it('should throw when plugin folder does not exist', () => {
      const pluginDir = path.join(tmpDir, 'inst1', 'ShooterGame', 'Binaries', 'Win64', 'ArkApi', 'Plugins');
      fs.mkdirSync(pluginDir, { recursive: true });

      expect(() => service.removePlugin('inst1', 'NonExistent')).toThrow('not found');
    });
  });

  describe('installPluginFromZipPath', () => {
    it('should throw when zip file does not exist', () => {
      expect(() => service.installPluginFromZipPath('inst1', '/nonexistent.zip')).toThrow('ZIP file not found');
    });
  });
});
