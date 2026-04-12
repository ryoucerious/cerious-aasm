import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const mockGetArkServerDir = jest.fn();
jest.mock('../utils/ark/ark-path.utils', () => ({
  ArkPathUtils: {
    getArkServerDir: mockGetArkServerDir,
  },
}));

describe('WhitelistService', () => {
  let WhitelistService: any;
  let service: any;
  let tmpDir: string;
  let instanceDir: string;
  let mainArkDir: string;

  beforeAll(() => {
    const mod = require('./whitelist.service');
    WhitelistService = mod.WhitelistService;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whitelist-test-'));
    instanceDir = path.join(tmpDir, 'instance1');
    mainArkDir = path.join(tmpDir, 'ark-server');
    fs.mkdirSync(instanceDir, { recursive: true });
    mockGetArkServerDir.mockReturnValue(mainArkDir);
    service = new WhitelistService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('loadWhitelistFromInstance', () => {
    it('should return empty list when no whitelist file exists', () => {
      const result = service.loadWhitelistFromInstance(instanceDir);

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual([]);
      expect(result.message).toContain('empty whitelist');
    });

    it('should load player IDs from whitelist file', () => {
      const content = [
        '# Comment line',
        'player123',
        'player456',
        '',
        '# Another comment',
        'player789',
      ].join('\n');
      fs.writeFileSync(path.join(instanceDir, 'PlayersExclusiveJoinList.txt'), content, 'utf8');

      const result = service.loadWhitelistFromInstance(instanceDir);

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['player123', 'player456', 'player789']);
      expect(result.message).toContain('3');
    });

    it('should handle file read errors', () => {
      // Create a directory where the file should be to cause a read error
      const whitelistPath = path.join(instanceDir, 'PlayersExclusiveJoinList.txt');
      fs.mkdirSync(whitelistPath, { recursive: true });

      const result = service.loadWhitelistFromInstance(instanceDir);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('writeWhitelistFile', () => {
    it('should write whitelist file to instance directory', () => {
      const result = service.writeWhitelistFile(instanceDir, ['player1', 'player2']);

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['player1', 'player2']);

      const content = fs.readFileSync(
        path.join(instanceDir, 'PlayersExclusiveJoinList.txt'),
        'utf8'
      );
      expect(content).toContain('player1');
      expect(content).toContain('player2');
      expect(content).toContain('# ARK: Survival Ascended');
    });

    it('should filter out empty player IDs', () => {
      service.writeWhitelistFile(instanceDir, ['player1', '', '  ', 'player2']);

      const content = fs.readFileSync(
        path.join(instanceDir, 'PlayersExclusiveJoinList.txt'),
        'utf8'
      );
      const lines = content.split('\n').filter((l: string) => l && !l.startsWith('#'));
      expect(lines).toEqual(['player1', 'player2']);
    });

    it('should create instance directory if not exists', () => {
      const newDir = path.join(tmpDir, 'new-instance');
      const result = service.writeWhitelistFile(newDir, ['player1']);

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(newDir, 'PlayersExclusiveJoinList.txt'))).toBe(true);
    });
  });

  describe('addToInstanceWhitelist', () => {
    it('should add a new player', () => {
      // Start with one player
      service.writeWhitelistFile(instanceDir, ['existing']);

      const result = service.addToInstanceWhitelist(instanceDir, 'newplayer');

      expect(result.success).toBe(true);
      expect(result.playerIds).toContain('existing');
      expect(result.playerIds).toContain('newplayer');
    });

    it('should not duplicate existing player', () => {
      service.writeWhitelistFile(instanceDir, ['player1']);

      const result = service.addToInstanceWhitelist(instanceDir, 'player1');

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['player1']);
      expect(result.message).toContain('already whitelisted');
    });

    it('should add to empty whitelist', () => {
      const result = service.addToInstanceWhitelist(instanceDir, 'first_player');

      expect(result.success).toBe(true);
      expect(result.playerIds).toContain('first_player');
    });
  });

  describe('removeFromInstanceWhitelist', () => {
    it('should remove an existing player', () => {
      service.writeWhitelistFile(instanceDir, ['player1', 'player2', 'player3']);

      const result = service.removeFromInstanceWhitelist(instanceDir, 'player2');

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['player1', 'player3']);
    });

    it('should handle removing non-existent player', () => {
      service.writeWhitelistFile(instanceDir, ['player1']);

      const result = service.removeFromInstanceWhitelist(instanceDir, 'nonexistent');

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['player1']);
      expect(result.message).toContain('was not in the whitelist');
    });
  });

  describe('clearInstanceWhitelist', () => {
    it('should clear all players', () => {
      service.writeWhitelistFile(instanceDir, ['p1', 'p2', 'p3']);

      const result = service.clearInstanceWhitelist(instanceDir);

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual([]);
    });
  });

  describe('isPlayerWhitelistedInInstance', () => {
    it('should return true for whitelisted player', () => {
      service.writeWhitelistFile(instanceDir, ['player1', 'player2']);

      expect(service.isPlayerWhitelistedInInstance(instanceDir, 'player1')).toBe(true);
    });

    it('should return false for non-whitelisted player', () => {
      service.writeWhitelistFile(instanceDir, ['player1']);

      expect(service.isPlayerWhitelistedInInstance(instanceDir, 'other')).toBe(false);
    });

    it('should return false when no whitelist file exists', () => {
      const emptyDir = path.join(tmpDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });

      expect(service.isPlayerWhitelistedInInstance(emptyDir, 'player1')).toBe(false);
    });
  });

  describe('getInstanceWhitelistStats', () => {
    it('should return stats for existing whitelist', () => {
      service.writeWhitelistFile(instanceDir, ['p1', 'p2']);

      const stats = service.getInstanceWhitelistStats(instanceDir);

      expect(stats.playerCount).toBe(2);
      expect(stats.fileExists).toBe(true);
      expect(stats.filePath).toContain('PlayersExclusiveJoinList.txt');
    });

    it('should return zero counts for non-existent whitelist', () => {
      const emptyDir = path.join(tmpDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });

      const stats = service.getInstanceWhitelistStats(emptyDir);

      expect(stats.playerCount).toBe(0);
      expect(stats.fileExists).toBe(false);
    });
  });

  describe('copyWhitelistToMainDir', () => {
    it('should create empty whitelist when no instance file exists', () => {
      const result = service.copyWhitelistToMainDir(instanceDir);

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual([]);
      expect(result.message).toContain('empty whitelist');

      // Should have created WhitelistFile in main ARK dir
      const mainPath = path.join(mainArkDir, 'ShooterGame', 'Binaries', 'Win64', 'PlayersExclusiveJoinList.txt');
      expect(fs.existsSync(mainPath)).toBe(true);
    });

    it('should copy existing whitelist to main dir', () => {
      // Write a whitelist file to instance dir first
      service.writeWhitelistFile(instanceDir, ['player1', 'player2']);

      // Clear and re-create a fresh service so we can copy
      const result = service.copyWhitelistToMainDir(instanceDir);

      expect(result.success).toBe(true);
      expect(result.playerIds).toEqual(['player1', 'player2']);

      const mainPath = path.join(mainArkDir, 'ShooterGame', 'Binaries', 'Win64', 'PlayersExclusiveJoinList.txt');
      const content = fs.readFileSync(mainPath, 'utf8');
      expect(content).toContain('player1');
      expect(content).toContain('player2');
    });
  });
});
