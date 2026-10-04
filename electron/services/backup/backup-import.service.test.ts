// Real fs, zip and instance store: the bugs here were in how they interact.
jest.unmock('fs');
jest.unmock('path');
jest.unmock('crypto');

import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as instanceUtils from '../../utils/ark/instance.utils';
import { BackupImportService } from './backup-import.service';

jest.mock('../../utils/global-config.utils', () => ({ loadGlobalConfig: jest.fn() }));
jest.mock('../../utils/platform.utils', () => ({ getDefaultInstallDir: jest.fn() }));

const { loadGlobalConfig } = jest.requireMock('../../utils/global-config.utils') as { loadGlobalConfig: jest.Mock };

describe('BackupImportService (real fs)', () => {
  const service = new BackupImportService();
  let root: string;
  let serversDir: string;
  let archivePath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-import-test-'));
    loadGlobalConfig.mockReturnValue({ serverDataDir: root });
    serversDir = path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'Servers');
    archivePath = path.join(root, 'backup.zip');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeArchive(files: Record<string, string>): void {
    const zip = new AdmZip();
    for (const [entry, content] of Object.entries(files)) {
      zip.addFile(entry, Buffer.from(content));
    }
    zip.writeZip(archivePath);
  }

  const originalConfig = JSON.stringify({ id: 'old-server', name: 'Alpha', sessionName: 'Alpha', gamePort: 7778, state: 'running' });

  function serverDirs(): string[] {
    return fs.existsSync(serversDir) ? fs.readdirSync(serversDir).sort() : [];
  }

  // The archived config.json used to be copied in unchanged, still carrying the old id and name:
  // the import listed as a phantom of the original server and reported success regardless.
  it('imports a backup under its original name as a working, separate server', async () => {
    writeArchive({ 'config.json': originalConfig, 'SavedArks/TheIsland_WP/TheIsland_WP.ark': 'world' });

    const imported = await service.importBackupAsNewServer('Alpha', archivePath);

    expect(imported.id).not.toBe('old-server');
    expect(imported).toMatchObject({ name: 'Alpha', sessionName: 'Alpha', gamePort: 7778 });
    const onDisk = JSON.parse(fs.readFileSync(path.join(serversDir, imported.id, 'config.json'), 'utf8'));
    expect(onDisk).toEqual({ id: imported.id, name: 'Alpha', sessionName: 'Alpha', gamePort: 7778 });
    expect(fs.readFileSync(path.join(serversDir, imported.id, 'SavedArks', 'TheIsland_WP', 'TheIsland_WP.ark'), 'utf8')).toBe('world');
    expect((await instanceUtils.getAllInstances()).map(instance => instance.id)).toEqual([imported.id]);
  });

  it('refuses the name of a server that still exists, and leaves nothing behind', async () => {
    await instanceUtils.saveInstance({ id: 'old-server', name: 'Alpha' });
    writeArchive({ 'config.json': originalConfig });

    await expect(service.importBackupAsNewServer('alpha', archivePath)).rejects.toThrow('A server with this name already exists.');

    expect(serverDirs()).toEqual(['old-server']);
    expect((await instanceUtils.getAllInstances()).map(instance => instance.name)).toEqual(['Alpha']);
  });

  it('imports under a new name next to the original', async () => {
    await instanceUtils.saveInstance({ id: 'old-server', name: 'Alpha' });
    writeArchive({ 'config.json': originalConfig });

    const imported = await service.importBackupAsNewServer('Alpha copy', archivePath);

    expect((await instanceUtils.getAllInstances()).map(instance => [instance.id, instance.name]).sort())
      .toEqual([[imported.id, 'Alpha copy'], ['old-server', 'Alpha']].sort());
  });

  it('uses default settings when the backup has no usable config.json', async () => {
    writeArchive({ 'config.json': '{ not json', 'SavedArks/x.ark': 'world' });

    const imported = await service.importBackupAsNewServer('Beta', archivePath);

    expect(imported).toMatchObject({ name: 'Beta', sessionName: 'Beta', mapName: 'TheIsland_WP', gamePort: 7777 });
  });

  // A failed extraction used to leave the created directory behind.
  it('leaves no directory behind when the archive cannot be read', async () => {
    fs.writeFileSync(archivePath, 'not a zip');

    await expect(service.importBackupAsNewServer('Beta', archivePath)).rejects.toThrow();

    expect(serverDirs()).toEqual([]);
  });

  it('removes the new directory when saving the server fails', async () => {
    writeArchive({ 'config.json': originalConfig });
    jest.spyOn(instanceUtils, 'saveInstance').mockRejectedValueOnce(new Error('EACCES'));

    await expect(service.importBackupAsNewServer('Beta', archivePath)).rejects.toThrow('EACCES');

    expect(serverDirs()).toEqual([]);
  });

  it('does not create a backups folder inside the new server', async () => {
    writeArchive({ 'config.json': originalConfig });

    const imported = await service.importBackupAsNewServer('Beta', archivePath);

    expect(fs.readdirSync(path.join(serversDir, imported.id))).toEqual(['config.json']);
  });

  it('reports a missing archive', async () => {
    await expect(service.importBackupAsNewServer('Beta', path.join(root, 'missing.zip'))).rejects.toThrow('Backup file not found');
  });
});
