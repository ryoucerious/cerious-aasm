jest.unmock('fs');
jest.unmock('path');
jest.mock('../utils/ark/instance.utils', () => ({ getInstanceDir: jest.fn() }));
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { getInstanceDir } from '../utils/ark/instance.utils';
import { ArkApiPluginService } from './ark-api-plugin.service';

describe('Cloned API files', () => {
  let root: string;
  const service = new ArkApiPluginService();
  const win64 = (id: string) => path.join(root, id, 'ShooterGame/Binaries/Win64');
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-clone-'));
    jest.mocked(getInstanceDir).mockImplementation(id => path.join(root, id));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  it('copies plugins, their config and loader, without logs or game files', () => {
    const plugin = path.join(win64('source'), 'ArkApi/Plugins/Test');
    fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(path.join(plugin, 'Test.dll'), 'plugin');
    fs.writeFileSync(path.join(plugin, 'config.json'), '{"enabled":true}');
    fs.writeFileSync(path.join(plugin, 'current.log'), 'busy');
    fs.writeFileSync(path.join(win64('source'), 'AsaApiLoader.exe'), 'loader');
    fs.writeFileSync(path.join(win64('source'), 'ArkAscendedServer.exe'), 'game');
    service.importCloneFiles('copy', service.exportCloneFiles('source'));
    expect(fs.readFileSync(path.join(win64('copy'), 'ArkApi/Plugins/Test/config.json'), 'utf8')).toContain('true');
    expect(fs.readFileSync(path.join(win64('copy'), 'AsaApiLoader.exe'), 'utf8')).toBe('loader');
    expect(fs.existsSync(path.join(win64('copy'), 'ArkAscendedServer.exe'))).toBe(false);
    expect(fs.existsSync(path.join(win64('copy'), 'ArkApi/Plugins/Test/current.log'))).toBe(false);
  });
  it('rejects archives outside the permitted API files', () => {
    const zip = new AdmZip();
    zip.addFile('config.json', Buffer.from('bad'));
    expect(() => service.importCloneFiles('copy', zip.toBuffer().toString('base64'))).toThrow('Unsafe');
    expect(fs.existsSync(win64('copy'))).toBe(false);
  });
});
