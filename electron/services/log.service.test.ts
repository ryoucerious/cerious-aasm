jest.mock('node-pty', () => ({
  spawn: jest.fn(),
}));

import * as fs from 'fs';
import * as path from 'path';
import { LogService } from '../services/log.service';
import { getArkServerDir } from '../utils/ark/ark-server/ark-server-paths.utils';

jest.mock('fs');
jest.mock('path');
jest.mock('../utils/ark/ark-server/ark-server-paths.utils', () => ({ getArkServerDir: jest.fn() }));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;
const mockGetArkServerDir = getArkServerDir as jest.MockedFunction<typeof getArkServerDir>;

describe('LogService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('clearArkLogFiles', () => {
    it('should clear all ARK log files when logs directory exists', () => {
      const mockLogsDir = '/mock/ark/server/ShooterGame/Saved/Logs';
      const mockLogFiles = ['ShooterGame.log', 'ShooterGame_001.log', 'ShooterGame_002.log', 'not-a-log.txt'];

      mockGetArkServerDir.mockReturnValue('/mock/ark/server');
      mockPath.join
        .mockReturnValueOnce(mockLogsDir) // logsDir path
        .mockReturnValueOnce(`${mockLogsDir}/ShooterGame.log`)
        .mockReturnValueOnce(`${mockLogsDir}/ShooterGame_001.log`)
        .mockReturnValueOnce(`${mockLogsDir}/ShooterGame_002.log`);

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(mockLogFiles as any);
      mockFs.writeFileSync.mockImplementation(() => {});

      LogService.clearArkLogFiles();

      expect(mockGetArkServerDir).toHaveBeenCalled();
      expect(mockPath.join).toHaveBeenCalledWith('/mock/ark/server', 'ShooterGame', 'Saved', 'Logs');
      expect(mockFs.existsSync).toHaveBeenCalledWith(mockLogsDir);

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(3);
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(`${mockLogsDir}/ShooterGame.log`, '', 'utf8');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(`${mockLogsDir}/ShooterGame_001.log`, '', 'utf8');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(`${mockLogsDir}/ShooterGame_002.log`, '', 'utf8');
    });

    it('should do nothing when logs directory does not exist', () => {
      const mockLogsDir = '/mock/ark/server/ShooterGame/Saved/Logs';

      mockGetArkServerDir.mockReturnValue('/mock/ark/server');
      mockPath.join.mockReturnValue(mockLogsDir);
      mockFs.existsSync.mockReturnValue(false);

      LogService.clearArkLogFiles();

      expect(mockGetArkServerDir).toHaveBeenCalled();
      expect(mockFs.existsSync).toHaveBeenCalledWith(mockLogsDir);
      expect(mockFs.readdirSync).not.toHaveBeenCalled();
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockGetArkServerDir.mockImplementation(() => {
        throw new Error('Mock error');
      });

      LogService.clearArkLogFiles();

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[log-service] Failed to clear ARK log files:',
        new Error('Mock error')
      );

      consoleSpy.mockRestore();
    });

    it('should only clear files matching the ARK log pattern', () => {
      const mockLogsDir = '/mock/ark/server/ShooterGame/Saved/Logs';
      const mockLogFiles = [
        'ShooterGame.log',           // Should clear
        'ShooterGame_001.log',       // Should clear
        'ShooterGame_123.log',       // Should clear
        'random.log',                // Should NOT clear
        'ShooterGame.txt',           // Should NOT clear
        'some-other-file.log',       // Should NOT clear
      ];

      mockGetArkServerDir.mockReturnValue('/mock/ark/server');
      mockPath.join.mockReturnValue(mockLogsDir);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(mockLogFiles as any);
      mockFs.writeFileSync.mockImplementation(() => {});

      LogService.clearArkLogFiles();

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(3);
    });
  });
});