/// <reference types="jest" />
import * as fs from 'fs';
import * as path from 'path';
import { ArkPathUtils } from './ark-path.utils';
import { ArkLogUtils } from './ark-log.utils';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: jest.fn((...args: string[]) => args.join('/')),
}));

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
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(ArkLogUtils.getLatestLogFile('session')).toBeNull();
    });
    it('should return null if no log files', () => {
      jest.spyOn(ArkPathUtils, 'getArkLogsDir').mockReturnValue('/logs');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([]);
      expect(ArkLogUtils.getLatestLogFile('session')).toBeNull();
    });
    it('should return most recent log if no session match', () => {
      jest.spyOn(ArkPathUtils, 'getArkLogsDir').mockReturnValue('/logs');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'ShooterGame.log',
        'ShooterGame_1.log'
      ]);
      (fs.statSync as jest.Mock).mockImplementation((file: string) => ({
        mtime: new Date(file.includes('1') ? 1000 : 2000),
        isFile: () => true,
      }));
      (fs.readFileSync as jest.Mock).mockReturnValue('');
      expect(ArkLogUtils.getLatestLogFile('session')).toBe('/logs/ShooterGame.log');
    });
    it('should return log file matching session name', () => {
      jest.spyOn(ArkPathUtils, 'getArkLogsDir').mockReturnValue('/logs');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'ShooterGame.log',
        'ShooterGame_1.log'
      ]);
      (fs.statSync as jest.Mock).mockImplementation((file: string) => ({
        mtime: new Date(file.includes('1') ? 1000 : 2000),
        isFile: () => true,
      }));
      (fs.readFileSync as jest.Mock).mockImplementation((file: string) => {
        return file.includes('1') ? 'SessionName=session' : '';
      });
      expect(ArkLogUtils.getLatestLogFile('session')).toBe('/logs/ShooterGame_1.log');
    });
    it('should skip unreadable log files', () => {
      jest.spyOn(ArkPathUtils, 'getArkLogsDir').mockReturnValue('/logs');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'ShooterGame.log',
        'ShooterGame_1.log'
      ]);
      (fs.statSync as jest.Mock).mockImplementation((file: string) => ({
        mtime: new Date(file.includes('1') ? 1000 : 2000),
        isFile: () => true,
      }));
      (fs.readFileSync as jest.Mock).mockImplementation((file: string) => {
        if (file.includes('1')) throw new Error('fail');
        return '';
      });
      expect(ArkLogUtils.getLatestLogFile('session')).toBe('/logs/ShooterGame.log');
    });
    it('should handle error in try/catch and return null', () => {
      jest.spyOn(ArkPathUtils, 'getArkLogsDir').mockReturnValue('/logs');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockImplementation(() => { throw new Error('fail'); });
      expect(ArkLogUtils.getLatestLogFile('session')).toBeNull();
    });
  });
});
