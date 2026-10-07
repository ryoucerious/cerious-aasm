jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('path');
jest.unmock('node:path');
jest.unmock('crypto');
jest.unmock('node:crypto');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { createHash } from 'crypto';

jest.mock('../../utils/platform.utils', () => ({ getDefaultInstallDir: jest.fn() }));

import { getDefaultInstallDir } from '../../utils/platform.utils';
import {
  archiveInstance, beginStage, checkpointManifest, checksumTree, fileDigest, finishStage, promoteStaged, pruneMeshFolders, writeStagedFile
} from './checkpoint';

const SAVE = 'SavedArks/TheIsland_WP/TheIsland_WP.ark';

/**
 * The checkpoint checksum, worked out here: sha256 over each path then its bytes, paths in
 * code-point order so every machine agrees whatever its locale.
 */
function expectedChecksum(files: Array<[string, string]>): string {
  const hash = createHash('sha256');
  for (const [rel, text] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    hash.update(rel);
    hash.update(Buffer.from(text));
  }
  return hash.digest('hex');
}

describe('checkpoint', () => {
  let root: string;
  let servers: string;
  const files: Array<[string, string]> = [['config.json', '{"id":"isle"}'], [SAVE, 'world']];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-ckpt-'));
    jest.mocked(getDefaultInstallDir).mockReturnValue(root);
    servers = path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'Servers');
    fs.mkdirSync(servers, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeServer(serverId: string, contents = files): void {
    for (const [rel, text] of contents) {
      fs.mkdirSync(path.dirname(path.join(servers, serverId, rel)), { recursive: true });
      fs.writeFileSync(path.join(servers, serverId, rel), text);
    }
  }

  async function stage(serverId: string, contents = files): Promise<string> {
    beginStage(serverId);
    for (const [rel, text] of contents) await writeStagedFile(serverId, rel, Readable.from(Buffer.from(text)));
    return finishStage(serverId, contents.map(([rel]) => rel));
  }

  describe('the source', () => {
    it('lists the config and saves, in checksum order', () => {
      writeServer('isle');
      fs.mkdirSync(path.join(servers, 'isle', 'Logs'), { recursive: true });
      fs.writeFileSync(path.join(servers, 'isle', 'Logs', 'server.log'), 'not moved');

      expect(checkpointManifest('isle')).toEqual([SAVE, 'config.json']);
    });

    // The exclusive join list stayed behind; the moved server started letting nobody in, or anyone.
    it('carries the server\'s exclusive join list and what it brought into its cluster', () => {
      writeServer('isle');
      fs.writeFileSync(path.join(servers, 'isle', 'PlayersExclusiveJoinList.txt'), '0002a1b2c3d4e5f60718293a4b5c6d7e\n');
      fs.writeFileSync(path.join(servers, 'isle', 'cluster-import.json'), '{"carried":[]}');

      expect(checkpointManifest('isle')).toEqual(['PlayersExclusiveJoinList.txt', SAVE, 'cluster-import.json', 'config.json']);
    });

    it('checksums the listed files the same way the destination does', async () => {
      writeServer('isle');

      expect(await checksumTree(path.join(servers, 'isle'), checkpointManifest('isle'))).toBe(expectedChecksum(files));
    });
  });

  describe('the destination', () => {
    it('stages streamed files outside the server list and returns their checksum', async () => {
      expect(await stage('isle')).toBe(expectedChecksum(files));
      expect(fs.readdirSync(servers)).toEqual([]);
    });

    it('streams a file larger than one chunk without changing it', async () => {
      const big = Buffer.alloc(3 * 1024 * 1024 + 7, 'ab');
      beginStage('isle');
      await writeStagedFile('isle', SAVE, Readable.from([big.subarray(0, 1000), big.subarray(1000)]));
      await writeStagedFile('isle', 'config.json', Readable.from(Buffer.from('{}')));
      await finishStage('isle', [SAVE, 'config.json']);
      promoteStaged('isle');

      expect(fs.readFileSync(path.join(servers, 'isle', SAVE)).equals(big)).toBe(true);
    });

    it('refuses a file that would land outside the server directory', async () => {
      beginStage('isle');
      await expect(writeStagedFile('isle', '../escape.txt', Readable.from(Buffer.from('x')))).rejects.toThrow(/inside the instance/);
      await expect(writeStagedFile('isle', 'C:/escape.txt', Readable.from(Buffer.from('x')))).rejects.toThrow(/inside the instance/);
    });

    it('will not finish when a listed file never arrived', async () => {
      beginStage('isle');
      await writeStagedFile('isle', 'config.json', Readable.from(Buffer.from('{}')));

      await expect(finishStage('isle', ['config.json', SAVE])).rejects.toThrow(/did not arrive/);
    });

    // A continued move keeps what an earlier attempt sent, which can include a file the server
    // no longer has.
    it('drops files an earlier attempt left that this move does not list', async () => {
      beginStage('isle');
      await writeStagedFile('isle', 'config.json', Readable.from(Buffer.from('{}')));
      await writeStagedFile('isle', 'extra.bin', Readable.from(Buffer.from('?')));

      expect(await finishStage('isle', ['config.json'])).toBe(expectedChecksum([['config.json', '{}']]));
      expect(fs.existsSync(path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'MeshIncoming', 'isle', 'extra.bin'))).toBe(false);
    });

    describe('continuing an interrupted move', () => {
      const staged = (rel: string) => path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'MeshIncoming', 'isle', rel);
      const sha = (text: string) => createHash('sha256').update(text).digest('hex');

      async function interrupted(): Promise<void> {
        beginStage('isle');
        await writeStagedFile('isle', 'config.json', Readable.from(Buffer.from('{"id":"isle"}')));
        await writeStagedFile('isle', SAVE, Readable.from(Buffer.from('wor'))); // cut off part way
      }

      it('keeps what an earlier attempt received, and says what it holds', async () => {
        await interrupted();

        expect(await beginStage('isle', { resume: true })).toEqual([
          { rel: SAVE, size: 3, sha256: sha('wor') },
          { rel: 'config.json', size: 13, sha256: sha('{"id":"isle"}') }
        ]);
        expect(fs.readFileSync(staged(SAVE), 'utf8')).toBe('wor');
      });

      it('says only what it holds of the files it is asked about', async () => {
        await interrupted();

        expect(await beginStage('isle', { resume: true, rels: [SAVE, 'never-sent.bin'] })).toEqual([{ rel: SAVE, size: 3, sha256: sha('wor') }]);
      });

      it('holds nothing for a server it has not been sent', async () => {
        expect(await beginStage('isle', { resume: true })).toEqual([]);
      });

      it('carries on a file from where its copy ends', async () => {
        await interrupted();

        await writeStagedFile('isle', SAVE, Readable.from(Buffer.from('ld')), 3);

        expect(fs.readFileSync(staged(SAVE), 'utf8')).toBe('world');
      });

      it('carries on from an earlier point, dropping what came after it', async () => {
        await interrupted();
        await writeStagedFile('isle', SAVE, Readable.from(Buffer.from('ldXX')), 3);

        await writeStagedFile('isle', SAVE, Readable.from(Buffer.from('ld')), 3);

        expect(fs.readFileSync(staged(SAVE), 'utf8')).toBe('world');
      });

      it('refuses to carry on past the end of what it holds', async () => {
        await interrupted();

        await expect(writeStagedFile('isle', SAVE, Readable.from(Buffer.from('d')), 4)).rejects.toThrow('only 3 bytes');
      });

      it('fingerprints a whole file, or the start of one, the same on both ends', async () => {
        await interrupted();

        expect(await fileDigest(staged(SAVE))).toBe(sha('wor'));
        expect(await fileDigest(staged(SAVE), 2)).toBe(sha('wo'));
        expect(await fileDigest(staged(SAVE), 0)).toBe(sha(''));
      });
    });

    it('starts a new transfer from nothing, dropping files from an earlier attempt', async () => {
      beginStage('isle');
      await writeStagedFile('isle', 'stale.bin', Readable.from(Buffer.from('old')));

      expect(await stage('isle')).toBe(expectedChecksum(files));
    });
  });

  describe('pruning', () => {
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    let saved: string;

    beforeEach(() => {
      saved = path.join(root, 'AASMServer', 'ShooterGame', 'Saved');
    });

    /** Backdates every file and folder under `dir`. */
    function age(dir: string, at: number): void {
      const when = new Date(at);
      const walk = (target: string) => {
        if (fs.statSync(target).isDirectory()) for (const name of fs.readdirSync(target)) walk(path.join(target, name));
        fs.utimesSync(target, when, when);
      };
      walk(dir);
    }

    it('removes the files of a move that stopped arriving more than a day ago', async () => {
      const now = Date.now();
      await stage('old');
      age(path.join(saved, 'MeshIncoming', 'old'), now - 25 * HOUR);
      await stage('fresh');

      pruneMeshFolders(now);

      expect(fs.readdirSync(path.join(saved, 'MeshIncoming'))).toEqual(['fresh']);
    });

    // Long enough to continue the move after an outage.
    it('keeps the files of an interrupted move for a day', async () => {
      const now = Date.now();
      await stage('isle');
      age(path.join(saved, 'MeshIncoming', 'isle'), now - 20 * HOUR);

      pruneMeshFolders(now);

      expect(fs.existsSync(path.join(saved, 'MeshIncoming', 'isle', SAVE))).toBe(true);
    });

    it('keeps a transfer that is still receiving files, however long it has run', async () => {
      const now = Date.now();
      await stage('isle');
      age(path.join(saved, 'MeshIncoming', 'isle'), now - 3 * HOUR);
      fs.utimesSync(path.join(saved, 'MeshIncoming', 'isle', SAVE), new Date(now), new Date(now));

      pruneMeshFolders(now);

      expect(fs.existsSync(path.join(saved, 'MeshIncoming', 'isle', SAVE))).toBe(true);
    });

    it('removes copies set aside more than two weeks ago', () => {
      const now = Date.now();
      for (const name of [`isle-${now - 15 * DAY}`, `isle-${now - DAY}`]) {
        fs.mkdirSync(path.join(saved, 'MeshMoved', name), { recursive: true });
        fs.writeFileSync(path.join(saved, 'MeshMoved', name, 'config.json'), '{}');
      }

      pruneMeshFolders(now);

      expect(fs.readdirSync(path.join(saved, 'MeshMoved'))).toEqual([`isle-${now - DAY}`]);
    });

    it('leaves alone anything it did not put there', () => {
      const now = Date.now();
      fs.mkdirSync(path.join(saved, 'MeshMoved', 'keep-me'), { recursive: true });
      age(path.join(saved, 'MeshMoved', 'keep-me'), now - 60 * DAY);

      pruneMeshFolders(now);

      expect(fs.readdirSync(path.join(saved, 'MeshMoved'))).toEqual(['keep-me']);
    });

    it('does nothing on a node that has never moved a server', () => {
      expect(() => pruneMeshFolders(Date.now())).not.toThrow();
    });
  });

  describe('promotion and archiving', () => {
    it('promotes staged files into the server directory once', async () => {
      await stage('isle');

      expect(promoteStaged('isle')).toBe(true);

      expect(fs.readFileSync(path.join(servers, 'isle', SAVE), 'utf8')).toBe('world');
      expect(promoteStaged('isle')).toBe(false);
    });

    it('promotes onto a node that has no servers yet', async () => {
      fs.rmSync(servers, { recursive: true, force: true });
      await stage('isle');

      expect(promoteStaged('isle')).toBe(true);

      expect(fs.readFileSync(path.join(servers, 'isle', 'config.json'), 'utf8')).toBe('{"id":"isle"}');
    });

    it('replaces a stale copy of the server when it promotes, keeping that copy aside', async () => {
      writeServer('isle', [['config.json', '{"stale":true}']]);
      await stage('isle');

      promoteStaged('isle');

      expect(fs.readFileSync(path.join(servers, 'isle', 'config.json'), 'utf8')).toBe('{"id":"isle"}');
      const moved = path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'MeshMoved');
      expect(fs.readdirSync(moved).map(name => fs.readFileSync(path.join(moved, name, 'config.json'), 'utf8'))).toEqual(['{"stale":true}']);
    });

    it('archives a server that has moved away so it leaves this node\'s server list', () => {
      writeServer('isle');

      const archived = archiveInstance('isle');

      expect(fs.readdirSync(servers)).toEqual([]);
      expect(fs.readFileSync(path.join(archived!, SAVE), 'utf8')).toBe('world');
    });
  });
});
