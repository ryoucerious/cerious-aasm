import { isPortInUse } from '../utils/network.utils';

// Mock the http and net modules
jest.mock('net', () => ({
  Socket: jest.fn().mockImplementation(() => ({
    setTimeout: jest.fn(),
    once: jest.fn(),
    connect: jest.fn(),
    destroy: jest.fn()
  }))
}));

jest.mock('http', () => ({
  request: jest.fn()
}));

const mockNet = require('net');
const mockHttp = require('http');

describe('network.utils', () => {
  let mockSocket: any;
  let mockHttpRequest: any;
  let httpRequestCallback: Function | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    httpRequestCallback = null;

    // Setup socket mock
    mockSocket = {
      setTimeout: jest.fn(),
      once: jest.fn(),
      connect: jest.fn(),
      destroy: jest.fn()
    };
    mockNet.Socket.mockReturnValue(mockSocket);

    // Setup HTTP request mock
    mockHttpRequest = {
      on: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn()
    };

    // Mock http.request to capture the callback
    mockHttp.request.mockImplementation((options: any, callback?: Function) => {
      if (callback) {
        httpRequestCallback = callback;
      }
      return mockHttpRequest;
    });
  });

  describe('isPortInUse', () => {
    describe('Web server ports (3000-9999)', () => {
      it('should return true when HTTP request succeeds', async () => {
        const port = 8080;
        const host = '127.0.0.1';

        // Mock successful HTTP response
        mockHttpRequest.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'error') {
            // No error for success case
          }
        });

        const resultPromise = isPortInUse(port, host);

        // Simulate successful response by calling the callback
        if (httpRequestCallback) {
          httpRequestCallback({});
        }

        const result = await resultPromise;

        expect(result).toBe(true);
        expect(mockHttp.request).toHaveBeenCalledTimes(1);
        expect(mockHttpRequest.end).toHaveBeenCalled();
        expect(mockHttpRequest.destroy).toHaveBeenCalled();
      });

      it('should return false when connection is refused', async () => {
        const port = 8080;
        const host = '127.0.0.1';

        // Mock connection refused error
        const mockError = { code: 'ECONNREFUSED' };
        mockHttpRequest.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'error') {
            callback(mockError);
          }
        });

        const result = await isPortInUse(port, host);

        expect(result).toBe(false);
        expect(mockHttpRequest.destroy).toHaveBeenCalled();
      });

      it('should return true when HTTP request returns other errors (server running)', async () => {
        const port = 8080;
        const host = '127.0.0.1';

        // Mock other HTTP error (like 404, 401, etc.)
        const mockError = { code: 'ENOTFOUND' };
        mockHttpRequest.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'error') {
            callback(mockError);
          }
        });

        const result = await isPortInUse(port, host);

        expect(result).toBe(true);
        expect(mockHttpRequest.destroy).toHaveBeenCalled();
      });

      it('should return false when request times out', async () => {
        const port = 8080;
        const host = '127.0.0.1';

        // Mock timeout
        mockHttpRequest.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'timeout') {
            callback();
          }
        });

        const result = await isPortInUse(port, host);

        expect(result).toBe(false);
        expect(mockHttpRequest.destroy).toHaveBeenCalled();
      });

      it('should use default host when not provided', async () => {
        const port = 8080;

        mockHttpRequest.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'error') {
            // No error
          }
        });

        const resultPromise = isPortInUse(port);

        // Simulate successful response
        if (httpRequestCallback) {
          httpRequestCallback({});
        }

        const result = await resultPromise;

        expect(result).toBe(true);
        expect(mockHttp.request).toHaveBeenCalledTimes(1);
      });
    });

    describe('Non-web server ports (< 3000 or > 9999)', () => {
      it('should return true when TCP connection succeeds', async () => {
        const port = 27015; // Steam port
        const host = '127.0.0.1';

        // Mock successful TCP connection
        mockSocket.once.mockImplementation((event: string, callback: Function) => {
          if (event === 'connect') {
            callback();
          }
        });

        const result = await isPortInUse(port, host);

        expect(result).toBe(true);
        expect(mockNet.Socket).toHaveBeenCalled();
        expect(mockSocket.setTimeout).toHaveBeenCalledWith(1000);
        expect(mockSocket.connect).toHaveBeenCalledWith(port, host);
        expect(mockSocket.destroy).toHaveBeenCalled();
      });

      it('should return false when TCP connection times out', async () => {
        const port = 27015;
        const host = '127.0.0.1';

        // Mock timeout
        mockSocket.once.mockImplementation((event: string, callback: Function) => {
          if (event === 'timeout') {
            callback();
          }
        });

        const result = await isPortInUse(port, host);

        expect(result).toBe(false);
        expect(mockSocket.destroy).toHaveBeenCalled();
      });

      it('should return false when TCP connection fails', async () => {
        const port = 27015;
        const host = '127.0.0.1';

        // Mock connection error
        const mockError = { code: 'ECONNREFUSED' };
        mockSocket.once.mockImplementation((event: string, callback: Function) => {
          if (event === 'error') {
            callback(mockError);
          }
        });

        const result = await isPortInUse(port, host);

        expect(result).toBe(false);
        expect(mockSocket.destroy).toHaveBeenCalled();
      });

      it('should handle ports below 3000', async () => {
        const port = 22; // SSH port

        mockSocket.once.mockImplementation((event: string, callback: Function) => {
          if (event === 'connect') {
            callback();
          }
        });

        const result = await isPortInUse(port);

        expect(result).toBe(true);
        expect(mockNet.Socket).toHaveBeenCalled();
        expect(mockSocket.connect).toHaveBeenCalledWith(port, '127.0.0.1');
      });

      it('should handle ports above 9999', async () => {
        const port = 27016; // Another Steam port

        mockSocket.once.mockImplementation((event: string, callback: Function) => {
          if (event === 'connect') {
            callback();
          }
        });

        const result = await isPortInUse(port);

        expect(result).toBe(true);
        expect(mockNet.Socket).toHaveBeenCalled();
        expect(mockSocket.connect).toHaveBeenCalledWith(port, '127.0.0.1');
      });
    });

    describe('Edge cases', () => {
      it('should handle port 3000 (boundary case)', async () => {
        const port = 3000;

        mockHttpRequest.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'error') {
            // No error
          }
        });

        const resultPromise = isPortInUse(port);

        // Simulate successful response
        if (httpRequestCallback) {
          httpRequestCallback({});
        }

        const result = await resultPromise;

        expect(result).toBe(true);
        expect(mockHttp.request).toHaveBeenCalled();
      });

      it('should handle port 9999 (boundary case)', async () => {
        const port = 9999;

        mockHttpRequest.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'error') {
            // No error
          }
        });

        const resultPromise = isPortInUse(port);

        // Simulate successful response
        if (httpRequestCallback) {
          httpRequestCallback({});
        }

        const result = await resultPromise;

        expect(result).toBe(true);
        expect(mockHttp.request).toHaveBeenCalled();
      });

      it('should handle port 2999 (just below web range)', async () => {
        const port = 2999;

        mockSocket.once.mockImplementation((event: string, callback: Function) => {
          if (event === 'connect') {
            callback();
          }
        });

        const result = await isPortInUse(port);

        expect(result).toBe(true);
        expect(mockNet.Socket).toHaveBeenCalled();
      });

      it('should handle port 10000 (just above web range)', async () => {
        const port = 10000;

        mockSocket.once.mockImplementation((event: string, callback: Function) => {
          if (event === 'connect') {
            callback();
          }
        });

        const result = await isPortInUse(port);

        expect(result).toBe(true);
        expect(mockNet.Socket).toHaveBeenCalled();
      });
    });
  });
});