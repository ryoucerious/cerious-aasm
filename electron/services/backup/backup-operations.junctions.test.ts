// Real fs: the behaviour under test is link semantics (junctions on Windows, symlinks elsewhere).
// A restore once deleted the shared ARK install: the clear/remove helpers used stat(), which
// follows a junction, so the recursive delete walked into the game files of every server.
jest.unmock('fs');
jest.unmock('path');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { removeDirectory } from '../../utils/fs.utils';
import { BackupOperationsService } from './backup-operations.service';

describe('BackupOperationsService filesystem safety (real fs)', () => {
  let tmpRoot: string;
  let sharedContent: string;
  let sharedEngine: string;
  let instanceDir: string;
  let linksSupported = true;

  const service = new BackupOperationsService() as any;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-backup-test-'));

    sharedContent = path.join(tmpRoot, 'AASMServer', 'ShooterGame', 'Content');
    sharedEngine = path.join(tmpRoot, 'AASMServer', 'Engine');
    fs.mkdirSync(path.join(sharedContent, 'Maps'), { recursive: true });
    fs.mkdirSync(sharedEngine, { recursive: true });
    fs.writeFileSync(path.join(sharedContent, 'Maps', 'TheIsland.uasset'), 'map-data');
    fs.writeFileSync(path.join(sharedEngine, 'engine.dll'), 'engine-data');

    instanceDir = path.join(tmpRoot, 'Servers', 'instance-1');
    const instanceShooterGame = path.join(instanceDir, 'ShooterGame');
    fs.mkdirSync(path.join(instanceShooterGame, 'Saved', 'SavedArks'), { recursive: true });
    fs.writeFileSync(path.join(instanceDir, 'config.json'), '{"id":"instance-1"}');
    fs.writeFileSync(path.join(instanceShooterGame, 'Saved', 'SavedArks', 'TheIsland.ark'), 'world');

    try {
      fs.symlinkSync(sharedContent, path.join(instanceShooterGame, 'Content'), 'junction');
      fs.symlinkSync(sharedEngine, path.join(instanceDir, 'Engine'), 'junction');
    } catch {
      // Links need privileges or a filesystem that supports them; the link tests are skipped.
      linksSupported = false;
    }
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  const sharedFilesIntact = () =>
    fs.existsSync(path.join(sharedContent, 'Maps', 'TheIsland.uasset')) &&
    fs.existsSync(path.join(sharedEngine, 'engine.dll'));

  it('clearServerDirectory empties the instance without deleting the shared install', async () => {
    if (!linksSupported) return;

    await service.clearServerDirectory(instanceDir);

    expect(fs.readdirSync(instanceDir)).toHaveLength(0);
    expect(sharedFilesIntact()).toBe(true);
  });

  it('clearServerDirectory removes the junction entries themselves', async () => {
    if (!linksSupported) return;

    await service.clearServerDirectory(instanceDir);

    expect(fs.existsSync(path.join(instanceDir, 'Engine'))).toBe(false);
    expect(fs.existsSync(path.join(instanceDir, 'ShooterGame'))).toBe(false);
    // The link targets survive as real directories
    expect(fs.existsSync(sharedContent)).toBe(true);
    expect(fs.existsSync(sharedEngine)).toBe(true);
  });

  it('removeDirectory does not follow a nested junction into the shared install', async () => {
    if (!linksSupported) return;

    await removeDirectory(path.join(instanceDir, 'ShooterGame'));

    expect(fs.existsSync(path.join(instanceDir, 'ShooterGame'))).toBe(false);
    expect(sharedFilesIntact()).toBe(true);
  });

  it('clearServerDirectory preserves backup-named entries', async () => {
    if (!linksSupported) return;

    fs.writeFileSync(path.join(instanceDir, 'backup-settings.json'), '{"enabled":true}');

    await service.clearServerDirectory(instanceDir);

    expect(fs.existsSync(path.join(instanceDir, 'backup-settings.json'))).toBe(true);
  });

  it('addToZip skips the instance ARK log directory', async () => {
    const logsDir = path.join(instanceDir, 'ShooterGame', 'Saved', 'Logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, 'ShooterGame.log'), 'x'.repeat(1024));

    const added: string[] = [];
    const zipStub = { addFile: (name: string) => added.push(name) };

    await service.addToZip(zipStub, instanceDir, '');

    expect(added.some(n => /Logs/.test(n))).toBe(false);
    // Saves and config are still archived
    expect(added.some(n => /TheIsland\.ark$/.test(n))).toBe(true);
    expect(added).toContain('config.json');
  });
});
