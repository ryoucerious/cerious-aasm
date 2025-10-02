
import { ipcMain } from 'electron';
import { ProtonService } from '../services/proton.service';

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn()
  }
}));
jest.mock('../services/proton.service');


const mockProtonService = jest.mocked(ProtonService.prototype);

// Capture handler registrations
const handlerMap: Record<string, Function> = {};
(ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
  handlerMap[channel] = handler;
});

// Import after mocking so handlerMap is populated
import '../handlers/proton-handler';

describe('Proton Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('check-proton-installed handler', () => {
    it('should handle check proton installation exception with string error', async () => {
      mockProtonService.checkProtonInstalled.mockRejectedValue('fail');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await handlerMap['check-proton-installed']();
      expect(consoleSpy).toHaveBeenCalledWith('[proton-handler] Unexpected error:', 'fail');
      expect(result).toEqual({
        success: false,
        installed: false,
        error: 'Unexpected error',
        path: null
      });
      consoleSpy.mockRestore();
    });
    it('should handle check proton installation exception with undefined error', async () => {
      mockProtonService.checkProtonInstalled.mockRejectedValue(undefined);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await handlerMap['check-proton-installed']();
      expect(consoleSpy).toHaveBeenCalledWith('[proton-handler] Unexpected error:', undefined);
      expect(result).toEqual({
        success: false,
        installed: false,
        error: 'Unexpected error',
        path: null
      });
      consoleSpy.mockRestore();
    });
    it('should check proton installation successfully', async () => {
      const expectedResult = {
        success: true,
        installed: true,
        message: 'Proton is installed',
        path: '/home/user/.steam/steam/compatibilitytools.d'
      };
      mockProtonService.checkProtonInstalled.mockResolvedValue(expectedResult);
      const result = await handlerMap['check-proton-installed']();
      expect(mockProtonService.checkProtonInstalled).toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
    });
    it('should handle check proton installation exception', async () => {
      const error = new Error('System error');
      mockProtonService.checkProtonInstalled.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await handlerMap['check-proton-installed']();
      expect(consoleSpy).toHaveBeenCalledWith('[proton-handler] Unexpected error:', error);
      expect(result).toEqual({
        success: false,
        installed: false,
        error: 'System error',
        path: null
      });
      consoleSpy.mockRestore();
    });
  });

  describe('install-proton handler', () => {
    it('should handle install proton exception with string error', async () => {
      mockProtonService.installProton.mockRejectedValue('fail');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await handlerMap['install-proton']();
      expect(consoleSpy).toHaveBeenCalledWith('[proton-handler] Unexpected error:', 'fail');
      expect(result).toEqual({
        success: false,
        error: 'Unexpected error'
      });
      consoleSpy.mockRestore();
    });
    it('should handle install proton exception with undefined error', async () => {
      mockProtonService.installProton.mockRejectedValue(undefined);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await handlerMap['install-proton']();
      expect(consoleSpy).toHaveBeenCalledWith('[proton-handler] Unexpected error:', undefined);
      expect(result).toEqual({
        success: false,
        error: 'Unexpected error'
      });
      consoleSpy.mockRestore();
    });
    it('should install proton successfully', async () => {
      const expectedResult = {
        success: true,
        message: 'Proton installed successfully',
        output: 'Installation completed'
      };
      mockProtonService.installProton.mockResolvedValue(expectedResult);
      const result = await handlerMap['install-proton']();
      expect(mockProtonService.installProton).toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
    });
    it('should handle install proton exception', async () => {
      const error = new Error('Network timeout');
      mockProtonService.installProton.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await handlerMap['install-proton']();
      expect(consoleSpy).toHaveBeenCalledWith('[proton-handler] Unexpected error:', error);
      expect(result).toEqual({
        success: false,
        error: 'Network timeout'
      });
      consoleSpy.mockRestore();
    });
  });

  describe('get-proton-dir handler', () => {
    it('should handle get proton directory exception with string error', async () => {
      mockProtonService.getProtonDirectory.mockRejectedValue('fail');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await handlerMap['get-proton-dir']();
      expect(consoleSpy).toHaveBeenCalledWith('[proton-handler] Unexpected error:', 'fail');
      expect(result).toEqual({
        success: false,
        error: 'Unexpected error',
        path: null
      });
      consoleSpy.mockRestore();
    });
    it('should handle get proton directory exception with undefined error', async () => {
      mockProtonService.getProtonDirectory.mockRejectedValue(undefined);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await handlerMap['get-proton-dir']();
      expect(consoleSpy).toHaveBeenCalledWith('[proton-handler] Unexpected error:', undefined);
      expect(result).toEqual({
        success: false,
        error: 'Unexpected error',
        path: null
      });
      consoleSpy.mockRestore();
    });
    it('should get proton directory successfully', async () => {
      const expectedResult = {
        success: true,
        path: '/home/user/.steam/steam/compatibilitytools.d',
        error: undefined
      };
      mockProtonService.getProtonDirectory.mockResolvedValue(expectedResult);
      const result = await handlerMap['get-proton-dir']();
      expect(mockProtonService.getProtonDirectory).toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
    });
    it('should handle get proton directory exception', async () => {
      const error = new Error('Directory error');
      mockProtonService.getProtonDirectory.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await handlerMap['get-proton-dir']();
      expect(consoleSpy).toHaveBeenCalledWith('[proton-handler] Unexpected error:', error);
      expect(result).toEqual({
        success: false,
        error: 'Directory error',
        path: null
      });
      consoleSpy.mockRestore();
    });
  });

  describe('get-platform-info handler', () => {
    it('should handle get platform info exception with string error', async () => {
      mockProtonService.getPlatformInfo.mockRejectedValue('fail');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await handlerMap['get-platform-info']();
      expect(consoleSpy).toHaveBeenCalledWith('[proton-handler] Unexpected error:', 'fail');
      expect(result).toEqual({
        success: false,
        error: 'Unexpected error',
        platform: 'unknown',
        needsProton: false,
        protonInstalled: false,
        ready: false
      });
      consoleSpy.mockRestore();
    });
    it('should handle get platform info exception with undefined error', async () => {
      mockProtonService.getPlatformInfo.mockRejectedValue(undefined);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await handlerMap['get-platform-info']();
      expect(consoleSpy).toHaveBeenCalledWith('[proton-handler] Unexpected error:', undefined);
      expect(result).toEqual({
        success: false,
        error: 'Unexpected error',
        platform: 'unknown',
        needsProton: false,
        protonInstalled: false,
        ready: false
      });
      consoleSpy.mockRestore();
    });
    it('should get platform info successfully', async () => {
      const expectedResult = {
        success: true,
        platform: 'linux',
        needsProton: true,
        protonInstalled: true,
        ready: true,
        error: undefined
      };
      mockProtonService.getPlatformInfo.mockResolvedValue(expectedResult);
      const result = await handlerMap['get-platform-info']();
      expect(mockProtonService.getPlatformInfo).toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
    });
    it('should handle get platform info exception', async () => {
      const error = new Error('Platform error');
      mockProtonService.getPlatformInfo.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await handlerMap['get-platform-info']();
      expect(consoleSpy).toHaveBeenCalledWith('[proton-handler] Unexpected error:', error);
      expect(result).toEqual({
        success: false,
        error: 'Platform error',
        platform: 'unknown',
        needsProton: false,
        protonInstalled: false,
        ready: false
      });
      consoleSpy.mockRestore();
    });
  });
});