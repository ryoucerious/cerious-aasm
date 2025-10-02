import * as fs from 'fs';
import * as path from 'path';
import { LogService } from '../services/log.service';
import { ArkPathUtils } from '../utils/ark.utils';

// Mock the dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('../utils/ark.utils');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;
const mockArkPathUtils = ArkPathUtils as jest.Mocked<typeof ArkPathUtils>;

describe('LogService', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('clearArkLogFiles', () => {
    it('should clear all ARK log files when logs directory exists', () => {
      // Arrange
      const mockLogsDir = '/mock/ark/server/ShooterGame/Saved/Logs';
      const mockLogFiles = ['ShooterGame.log', 'ShooterGame_001.log', 'ShooterGame_002.log', 'not-a-log.txt'];

      mockArkPathUtils.getArkServerDir.mockReturnValue('/mock/ark/server');
      mockPath.join
        .mockReturnValueOnce(mockLogsDir) // logsDir path
        .mockReturnValueOnce(`${mockLogsDir}/ShooterGame.log`)
        .mockReturnValueOnce(`${mockLogsDir}/ShooterGame_001.log`)
        .mockReturnValueOnce(`${mockLogsDir}/ShooterGame_002.log`);

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(mockLogFiles as any);
      mockFs.writeFileSync.mockImplementation(() => {});

      // Act
      LogService.clearArkLogFiles();

      // Assert
      expect(mockArkPathUtils.getArkServerDir).toHaveBeenCalled();
      expect(mockPath.join).toHaveBeenCalledWith('/mock/ark/server', 'ShooterGame', 'Saved', 'Logs');
      expect(mockFs.existsSync).toHaveBeenCalledWith(mockLogsDir);

      // Should clear the 3 log files but not the non-log file
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(3);
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(`${mockLogsDir}/ShooterGame.log`, '', 'utf8');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(`${mockLogsDir}/ShooterGame_001.log`, '', 'utf8');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(`${mockLogsDir}/ShooterGame_002.log`, '', 'utf8');
    });

    it('should do nothing when logs directory does not exist', () => {
      // Arrange
      const mockLogsDir = '/mock/ark/server/ShooterGame/Saved/Logs';

      mockArkPathUtils.getArkServerDir.mockReturnValue('/mock/ark/server');
      mockPath.join.mockReturnValue(mockLogsDir);
      mockFs.existsSync.mockReturnValue(false);

      // Act
      LogService.clearArkLogFiles();

      // Assert
      expect(mockArkPathUtils.getArkServerDir).toHaveBeenCalled();
      expect(mockFs.existsSync).toHaveBeenCalledWith(mockLogsDir);
      expect(mockFs.readdirSync).not.toHaveBeenCalled();
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', () => {
      // Arrange
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockArkPathUtils.getArkServerDir.mockImplementation(() => {
        throw new Error('Mock error');
      });

      // Act
      LogService.clearArkLogFiles();

      // Assert
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[LogService] Failed to clear ARK log files:',
        new Error('Mock error')
      );

      // Cleanup
      consoleSpy.mockRestore();
    });

    it('should only clear files matching the ARK log pattern', () => {
      // Arrange
      const mockLogsDir = '/mock/ark/server/ShooterGame/Saved/Logs';
      const mockLogFiles = [
        'ShooterGame.log',           // Should clear
        'ShooterGame_001.log',       // Should clear
        'ShooterGame_123.log',       // Should clear
        'random.log',                // Should NOT clear
        'ShooterGame.txt',           // Should NOT clear
        'some-other-file.log',       // Should NOT clear
      ];

      mockArkPathUtils.getArkServerDir.mockReturnValue('/mock/ark/server');
      mockPath.join.mockReturnValue(mockLogsDir);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(mockLogFiles as any);
      mockFs.writeFileSync.mockImplementation(() => {});

      // Act
      LogService.clearArkLogFiles();

      // Assert - should only clear files matching the pattern ShooterGame.log or ShooterGame_XXX.log
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(3);
    });
  });
});