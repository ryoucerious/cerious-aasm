import { jest } from '@jest/globals';

// This suite exercises real filesystem behaviour in a temp directory, so it opts out of
// the global fs/path mocks in test/setup.ts, both here and inside the service under test.
jest.unmock('fs');
jest.unmock('path');

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getInstanceWhitelistPath } from '../utils/ark/ark-server/ark-server-paths.utils';
import { GlobalConfig, loadGlobalConfig } from '../utils/global-config.utils';
import { WhitelistService } from './whitelist.service';

// Instance folders resolve under <serverDataDir>/AASMServer/ShooterGame/Saved/Servers.
jest.mock('../utils/global-config.utils', () => ({ loadGlobalConfig: jest.fn() }));
jest.mock('../utils/ark/ark-server/ark-server-paths.utils', () => ({
  getArkServerDir: jest.fn(),
  getInstanceWhitelistPath: jest.fn(),
}));

const LIST = 'PlayersExclusiveJoinList.txt';
const HEADER = [
  '# ARK: Survival Ascended Exclusive Join List',
  '# One EOS/Player ID per line',
  '# Lines starting with # are comments and will be ignored',
  '# This file is managed by Cerious AASM',
  ''
].join('\n');

describe('WhitelistService', () => {
  let service: WhitelistService;
  let tmpDir: string;
  let instanceDir: string;
  let runtimeList: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whitelist test-'));
    instanceDir = path.join(tmpDir, 'AASMServer', 'ShooterGame', 'Saved', 'Servers', 'instance1');
    runtimeList = path.join(tmpDir, 'AASMServer', 'ShooterGame', 'Binaries', 'Win64', LIST);
    fs.mkdirSync(instanceDir, { recursive: true });
    jest.mocked(loadGlobalConfig).mockReturnValue({ serverDataDir: tmpDir } as GlobalConfig);
    jest.mocked(getInstanceWhitelistPath).mockReturnValue(runtimeList);
    service = new WhitelistService();
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const instanceList = () => fs.readFileSync(path.join(instanceDir, LIST), 'utf8');

  describe('loadWhitelistFromInstance', () => {
    it('should return empty list when no whitelist file exists', () => {
      const result = service.loadWhitelistFromInstance('instance1');

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual([]);
      expect(result.message).toContain('empty whitelist');
    });

    it('should load player IDs from whitelist file', () => {
      const content = ['# Comment line', 'player123', 'player456', '', '# Another comment', 'player789'].join('\r\n');
      fs.writeFileSync(path.join(instanceDir, LIST), content, 'utf8');

      const result = service.loadWhitelistFromInstance('instance1');

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['player123', 'player456', 'player789']);
      expect(result.message).toContain('3');
    });

    it('should handle file read errors', () => {
      // A directory where the file should be makes the read fail.
      fs.mkdirSync(path.join(instanceDir, LIST), { recursive: true });

      const result = service.loadWhitelistFromInstance('instance1');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('refuses an instance id that could leave the servers directory', () => {
      const result = service.loadWhitelistFromInstance('../instance1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid instance ID');
    });
  });

  describe('writeWhitelistFile', () => {
    it('writes the list to the instance folder and to the copy ARK reads', () => {
      const result = service.writeWhitelistFile('instance1', ['player1', 'player2']);

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['player1', 'player2']);
      expect(getInstanceWhitelistPath).toHaveBeenCalledWith('instance1');
      expect(instanceList()).toBe(`${HEADER}\nplayer1\nplayer2`);
      expect(fs.readFileSync(runtimeList, 'utf8')).toBe(instanceList());
    });

    it('should filter out empty player IDs', () => {
      service.writeWhitelistFile('instance1', ['player1', '', '  ', 'player2']);

      const lines = instanceList().split('\n').filter((l: string) => l && !l.startsWith('#'));
      expect(lines).toEqual(['player1', 'player2']);
    });

    it('does not create a folder for a server that does not exist', () => {
      const result = service.writeWhitelistFile('missing', ['player1']);

      expect(result.success).toBe(false);
      expect(fs.existsSync(path.join(path.dirname(instanceDir), 'missing'))).toBe(false);
    });

    it('refuses an invalid instance id without writing anything', () => {
      const result = service.writeWhitelistFile('..', ['player1']);

      expect(result.success).toBe(false);
      expect(fs.existsSync(path.join(path.dirname(instanceDir), LIST))).toBe(false);
      expect(fs.existsSync(runtimeList)).toBe(false);
    });
  });

  describe('addToInstanceWhitelist', () => {
    it('should add a new player', () => {
      service.writeWhitelistFile('instance1', ['existing']);

      const result = service.addToInstanceWhitelist('instance1', 'newplayer');

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['existing', 'newplayer']);
      expect(instanceList()).toContain('newplayer');
    });

    it('should not duplicate existing player', () => {
      service.writeWhitelistFile('instance1', ['player1']);

      const result = service.addToInstanceWhitelist('instance1', 'player1');

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['player1']);
      expect(result.message).toContain('already whitelisted');
    });

    it('should add to empty whitelist', () => {
      const result = service.addToInstanceWhitelist('instance1', 'first_player');

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['first_player']);
    });
  });

  describe('removeFromInstanceWhitelist', () => {
    it('should remove an existing player', () => {
      service.writeWhitelistFile('instance1', ['player1', 'player2', 'player3']);

      const result = service.removeFromInstanceWhitelist('instance1', 'player2');

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['player1', 'player3']);
    });

    it('should handle removing non-existent player', () => {
      service.writeWhitelistFile('instance1', ['player1']);

      const result = service.removeFromInstanceWhitelist('instance1', 'nonexistent');

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['player1']);
      expect(result.message).toContain('was not in the whitelist');
    });
  });

  describe('clearInstanceWhitelist', () => {
    it('should clear all players', () => {
      service.writeWhitelistFile('instance1', ['p1', 'p2', 'p3']);

      const result = service.clearInstanceWhitelist('instance1');

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual([]);
      expect(instanceList()).toBe(HEADER);
    });
  });

  describe('copyWhitelistToMainDir', () => {
    it('writes an empty list, header only, when the instance has none', () => {
      const result = service.copyWhitelistToMainDir('instance1');

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual([]);
      expect(result.message).toContain('empty whitelist');
      expect(fs.readFileSync(runtimeList, 'utf8')).toBe(HEADER);
    });

    it('should copy existing whitelist to main dir', () => {
      fs.writeFileSync(path.join(instanceDir, LIST), 'player1\nplayer2\n', 'utf8');

      const result = service.copyWhitelistToMainDir('instance1');

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['player1', 'player2']);
      expect(fs.readFileSync(runtimeList, 'utf8')).toBe('player1\nplayer2\n');
    });

    it('reports an instance id the instance store refuses', () => {
      const result = service.copyWhitelistToMainDir('bad id');

      expect(result.success).toBe(false);
      expect(fs.existsSync(runtimeList)).toBe(false);
    });
  });
});
