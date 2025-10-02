/// <reference types="jest" />
import * as fs from 'fs';
import * as path from 'path';
import { ArkPathUtils } from './ark-path.utils';
import { ArkLogUtils } from './ark-log.utils';

describe('ArkLogUtils', () => {
  describe('parseServerLogs', () => {
    it('should detect server started', () => {
      const log = 'Server ready\nListening on port 7777';
      const result = ArkLogUtils.parseServerLogs(log);
      expect(result.serverStarted).toBe(true);
    });
    it('should collect errors and warnings', () => {
      const log = 'Error: Something broke\nWarning: Something odd';
      const result = ArkLogUtils.parseServerLogs(log);
      expect(result.errors).toContain('Error: Something broke');
      expect(result.warnings).toContain('Warning: Something odd');
    });
    it('should collect player joins and leaves', () => {
      const log = 'Bob joined the game\nAlice left the game';
      const result = ArkLogUtils.parseServerLogs(log);
      expect(result.playerJoins).toContain('Bob joined the game');
      expect(result.playerLeaves).toContain('Alice left the game');
    });
    it('should handle empty log', () => {
      const result = ArkLogUtils.parseServerLogs('');
      expect(result.serverStarted).toBe(false);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.playerJoins).toEqual([]);
      expect(result.playerLeaves).toEqual([]);
    });
    it('should not detect server started if not present', () => {
      const result = ArkLogUtils.parseServerLogs('foo\nbar');
      expect(result.serverStarted).toBe(false);
    });
  });

  describe('getLatestLogFile', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });
    it('should return null if logs dir does not exist', () => {
      jest.spyOn(ArkPathUtils, 'getArkLogsDir').mockReturnValue('/logs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(ArkLogUtils.getLatestLogFile('session')).toBeNull();
    });
    it('should return null if no log files', () => {
      jest.spyOn(ArkPathUtils, 'getArkLogsDir').mockReturnValue('/logs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readdirSync').mockReturnValue([]);
      expect(ArkLogUtils.getLatestLogFile('session')).toBeNull();
    });
    it('should return most recent log if no session match', () => {
      jest.spyOn(ArkPathUtils, 'getArkLogsDir').mockReturnValue('/logs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      function mockDirent(name: string) {
        return {
          name: Buffer.from(name),
          parentPath: '',
          isFile: () => true,
          isDirectory: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        };
      }
      jest.spyOn(fs, 'readdirSync').mockImplementation((() => [
        'ShooterGame.log',
        'ShooterGame_1.log'
      ]) as any);
      jest.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));
        jest.spyOn(fs, 'statSync').mockImplementation((file) => {
          const stats = jest.requireActual('fs').statSync(__filename);
          const fileName = String(file);
          stats.mtime = new Date(fileName.includes('1') ? 1000 : 2000);
          return stats;
        });
        jest.spyOn(fs, 'readFileSync').mockImplementation((file) => {
          return '';
        });
  expect(ArkLogUtils.getLatestLogFile('session')).toBe('/logs/ShooterGame.log');
    });
    it('should return log file matching session name', () => {
      jest.spyOn(ArkPathUtils, 'getArkLogsDir').mockReturnValue('/logs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readdirSync').mockImplementation((() => [
        'ShooterGame.log',
        'ShooterGame_1.log'
      ]) as any);
      jest.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));
        jest.spyOn(fs, 'statSync').mockImplementation((file) => {
          const stats = jest.requireActual('fs').statSync(__filename);
          const fileName = String(file);
          stats.mtime = new Date(fileName.includes('1') ? 1000 : 2000);
          return stats;
        });
        jest.spyOn(fs, 'readFileSync').mockImplementation((file) => {
          const fileName = String(file);
          return fileName.includes('1') ? 'SessionName=session' : '';
        });
  expect(ArkLogUtils.getLatestLogFile('session')).toBe('/logs/ShooterGame_1.log');
    });
    it('should skip unreadable log files', () => {
      jest.spyOn(ArkPathUtils, 'getArkLogsDir').mockReturnValue('/logs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readdirSync').mockImplementation((() => [
        'ShooterGame.log',
        'ShooterGame_1.log'
      ]) as any);
      jest.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));
        jest.spyOn(fs, 'statSync').mockImplementation((file) => {
          const stats = jest.requireActual('fs').statSync(__filename);
          const fileName = String(file);
          stats.mtime = new Date(fileName.includes('1') ? 1000 : 2000);
          return stats;
        });
        jest.spyOn(fs, 'readFileSync').mockImplementation((file) => {
          const fileName = String(file);
          if (fileName.includes('1')) throw new Error('fail');
          return '';
        });
  expect(ArkLogUtils.getLatestLogFile('session')).toBe('/logs/ShooterGame.log');
    });
    it('should handle error in try/catch and return null', () => {
      jest.spyOn(ArkPathUtils, 'getArkLogsDir').mockReturnValue('/logs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readdirSync').mockImplementation(() => { throw new Error('fail'); });
      expect(ArkLogUtils.getLatestLogFile('session')).toBeNull();
    });
  });
});
