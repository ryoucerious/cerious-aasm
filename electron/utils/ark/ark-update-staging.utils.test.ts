// Real folders: these pin what is copied, moved and deleted, which a mocked file system would not.
jest.unmock('fs');
jest.unmock('fs-extra');
jest.unmock('path');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  changesBetween, listGameFiles, putInPlace, removeStaging, roomForStaging, seedStaging, stagingDirFor
} from './ark-update-staging.utils';

describe('ARK update staging', () => {
  let root: string;
  let install: string;
  let staging: string;

  function write(base: string, relative: string, text: string, mtime = new Date(2026, 0, 1)): void {
    const file = path.join(base, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    fs.utimesSync(file, mtime, mtime);
  }

  const read = (base: string, relative: string) => fs.readFileSync(path.join(base, ...relative.split('/')), 'utf8');
  const exists = (base: string, relative: string) => fs.existsSync(path.join(base, ...relative.split('/')));

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-staging-'));
    install = path.join(root, 'AASMServer');
    staging = stagingDirFor(install);
    write(install, 'Engine/Binaries/engine.dll', 'engine v1');
    write(install, 'ShooterGame/Content/Paks/game.pak', 'content v1');
    write(install, 'ShooterGame/Binaries/Win64/ArkAscendedServer.exe', 'exe v1');
    write(install, 'steamapps/appmanifest_2430930.acf', '"buildid" "100"');
    // Every server's folder, the managed clusters and the shared config live under Saved.
    write(install, 'ShooterGame/Saved/Servers/s1/SavedArks/TheIsland.ark', 'world');
    write(install, 'ShooterGame/Saved/AASMClusters/c1/player', 'upload');
    write(install, 'steamapps/downloading/2430930/chunk', 'partial');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('stages beside the install, on the same volume', () => {
    expect(stagingDirFor(install)).toBe(path.join(root, 'AASMServer-update'));
  });

  describe('listing the game files', () => {
    it('lists the install without its server data or SteamCMD\'s work folders', async () => {
      const listing = await listGameFiles(install);

      expect([...listing.keys()].sort()).toEqual([
        'Engine/Binaries/engine.dll',
        'ShooterGame/Binaries/Win64/ArkAscendedServer.exe',
        'ShooterGame/Content/Paks/game.pak',
        'steamapps/appmanifest_2430930.acf'
      ]);
      expect(listing.get('Engine/Binaries/engine.dll')).toEqual({ size: 9, mtimeMs: new Date(2026, 0, 1).getTime() });
    });

    it('does not follow links', async () => {
      fs.mkdirSync(path.join(root, 'elsewhere'));
      fs.writeFileSync(path.join(root, 'elsewhere', 'big.bin'), 'not part of the game');
      fs.symlinkSync(path.join(root, 'elsewhere'), path.join(install, 'ShooterGame', 'Linked'), 'junction');

      expect([...(await listGameFiles(install)).keys()]).not.toContain('ShooterGame/Linked/big.bin');
    });
  });

  describe('the room check', () => {
    it('needs the game files\' size plus a tenth free', async () => {
      const listing = await listGameFiles(install);
      const size = [...listing.values()].reduce((sum, entry) => sum + entry.size, 0);

      expect(roomForStaging(listing, Math.ceil(size * 1.1))).toEqual({ enough: true, needed: Math.ceil(size * 1.1), free: Math.ceil(size * 1.1) });
      expect(roomForStaging(listing, size).enough).toBe(false);
    });

    it('goes ahead when the free space cannot be read', async () => {
      expect(roomForStaging(await listGameFiles(install), null).enough).toBe(true);
    });
  });

  describe('seeding', () => {
    it('copies the game files with their times, and nothing else', async () => {
      await seedStaging(install, staging);

      expect(await listGameFiles(staging)).toEqual(await listGameFiles(install));
      expect(exists(staging, 'ShooterGame/Saved')).toBe(false);
      expect(exists(staging, 'steamapps/downloading')).toBe(false);
    });

    it('starts from nothing when an earlier copy was left behind', async () => {
      write(staging, 'ShooterGame/Content/Paks/stale.pak', 'left over');

      await seedStaging(install, staging);

      expect(exists(staging, 'ShooterGame/Content/Paks/stale.pak')).toBe(false);
    });

    it('reports how far it has got', async () => {
      const seen: number[] = [];

      await seedStaging(install, staging, percent => seen.push(percent));

      expect(seen.at(-1)).toBe(100);
      expect(seen).toEqual([...seen].sort((a, b) => a - b));
    });
  });

  describe('what an update changed', () => {
    it('is what was added or rewritten, and what was taken away', () => {
      const before = new Map([
        ['same', { size: 1, mtimeMs: 1 }],
        ['rewritten', { size: 1, mtimeMs: 1 }],
        ['resized', { size: 1, mtimeMs: 1 }],
        ['gone', { size: 1, mtimeMs: 1 }]
      ]);
      const after = new Map([
        ['same', { size: 1, mtimeMs: 1 }],
        ['rewritten', { size: 1, mtimeMs: 2 }],
        ['resized', { size: 2, mtimeMs: 1 }],
        ['added', { size: 1, mtimeMs: 1 }]
      ]);

      expect(changesBetween(before, after)).toEqual({ changed: ['rewritten', 'resized', 'added'], removed: ['gone'] });
    });
  });

  describe('putting the new files in place', () => {
    async function update(apply: () => void): Promise<ReturnType<typeof changesBetween>> {
      await seedStaging(install, staging);
      const before = await listGameFiles(staging);
      apply();
      return changesBetween(before, await listGameFiles(staging));
    }

    it('moves in what the update changed and deletes what it took away', async () => {
      const changes = await update(() => {
        write(staging, 'ShooterGame/Content/Paks/game.pak', 'content v2', new Date(2026, 1, 1));
        write(staging, 'ShooterGame/Content/Paks/new.pak', 'new content', new Date(2026, 1, 1));
        fs.rmSync(path.join(staging, 'Engine', 'Binaries', 'engine.dll'));
        write(staging, 'steamapps/appmanifest_2430930.acf', '"buildid" "200"', new Date(2026, 1, 1));
      });

      await putInPlace(staging, install, changes);

      expect(read(install, 'ShooterGame/Content/Paks/game.pak')).toBe('content v2');
      expect(read(install, 'ShooterGame/Content/Paks/new.pak')).toBe('new content');
      expect(exists(install, 'Engine/Binaries/engine.dll')).toBe(false);
      expect(read(install, 'steamapps/appmanifest_2430930.acf')).toBe('"buildid" "200"');
      expect(read(install, 'ShooterGame/Binaries/Win64/ArkAscendedServer.exe')).toBe('exe v1');
    });

    it('leaves the servers\' data, and files added by hand, alone', async () => {
      write(install, 'ShooterGame/Binaries/Win64/AsaApiLoader.exe', 'added by hand');
      const changes = await update(() => {
        write(staging, 'ShooterGame/Binaries/Win64/ArkAscendedServer.exe', 'exe v2', new Date(2026, 1, 1));
      });

      await putInPlace(staging, install, changes);

      expect(read(install, 'ShooterGame/Saved/Servers/s1/SavedArks/TheIsland.ark')).toBe('world');
      expect(read(install, 'ShooterGame/Saved/AASMClusters/c1/player')).toBe('upload');
      expect(read(install, 'ShooterGame/Binaries/Win64/AsaApiLoader.exe')).toBe('added by hand');
    });

    // The install says it is on the new build only once every other file is in.
    it('puts the Steam manifest in last', async () => {
      const changes = await update(() => {
        write(staging, 'steamapps/appmanifest_2430930.acf', '"buildid" "200"', new Date(2026, 1, 1));
        write(staging, 'ShooterGame/Content/Paks/game.pak', 'content v2', new Date(2026, 1, 1));
      });
      // However the listing happens to order them.
      changes.changed.sort((a, b) => Number(b.startsWith('steamapps/')) - Number(a.startsWith('steamapps/')));
      const renamed: string[] = [];
      const realRename = fs.promises.rename.bind(fs.promises);
      const rename = jest.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
        renamed.push(path.relative(install, String(to)).split(path.sep).join('/'));
        return realRename(from, to);
      });

      await putInPlace(staging, install, changes);
      rename.mockRestore();

      expect(renamed).toEqual(['ShooterGame/Content/Paks/game.pak', 'steamapps/appmanifest_2430930.acf']);
    });

    it('copies a file it cannot move', async () => {
      const changes = await update(() => {
        write(staging, 'ShooterGame/Content/Paks/game.pak', 'content v2', new Date(2026, 1, 1));
      });
      const rename = jest.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('cross-device link'), { code: 'EXDEV' }));

      await putInPlace(staging, install, changes);
      rename.mockRestore();

      expect(read(install, 'ShooterGame/Content/Paks/game.pak')).toBe('content v2');
    });

    it('refuses a path outside the game files', async () => {
      await expect(putInPlace(staging, install, { changed: ['ShooterGame/Saved/Servers/s1/x'], removed: [] })).rejects.toThrow('outside the game files');
      await expect(putInPlace(staging, install, { changed: [], removed: ['../elsewhere'] })).rejects.toThrow('outside the game files');
      expect(read(install, 'ShooterGame/Saved/Servers/s1/SavedArks/TheIsland.ark')).toBe('world');
    });
  });

  it('removes the staging folder, and does not mind when it is gone', async () => {
    await seedStaging(install, staging);

    await removeStaging(staging);
    await removeStaging(staging);

    expect(fs.existsSync(staging)).toBe(false);
    expect(exists(install, 'ShooterGame/Content/Paks/game.pak')).toBe(true);
  });
});
