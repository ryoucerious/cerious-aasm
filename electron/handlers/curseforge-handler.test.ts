import { jest } from '@jest/globals';

jest.mock('../services/messaging.service', () => ({
  messagingService: {
    on: jest.fn(),
    sendToOriginator: jest.fn(),
    sendToAll: jest.fn(),
  },
}));

jest.mock('electron', () => ({
  shell: {
    openExternal: jest.fn(),
  },
}));

// Mock https module
const mockGet = jest.fn();
jest.mock('https', () => ({
  get: mockGet,
}));

import { messagingService } from '../services/messaging.service';

const mockMessaging = messagingService as jest.Mocked<typeof messagingService>;

describe('curseforge-handler', () => {
  let handlers: Record<string, (...args: any[]) => Promise<void>>;
  let mockSender: any;

  beforeAll(() => {
    require('./curseforge-handler');

    handlers = {};
    for (const call of (mockMessaging.on as jest.Mock).mock.calls) {
      handlers[call[0] as string] = call[1] as any;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSender = { id: 'test-sender' };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should register all expected handlers', () => {
    expect(handlers['curseforge-search-mods']).toBeDefined();
    expect(handlers['curseforge-open-website']).toBeDefined();
    expect(handlers['curseforge-get-mod']).toBeDefined();
  });

  describe('curseforge-search-mods', () => {
    it('should fail when no API key is provided', async () => {
      await handlers['curseforge-search-mods']({ query: 'test', requestId: 'r1' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'curseforge-search-mods',
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('API key'),
          requestId: 'r1',
        }),
        mockSender
      );
    });

    it('should fail with empty API key', async () => {
      await handlers['curseforge-search-mods']({ query: 'test', apiKey: '', requestId: 'r1' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'curseforge-search-mods',
        expect.objectContaining({ success: false }),
        mockSender
      );
    });

    it('should make API request with valid key', async () => {
      // Mock the https.get to simulate a successful response
      const responseData = JSON.stringify({
        data: [{
          id: 123,
          name: 'Test Mod',
          summary: 'A test mod',
          downloadCount: 1000,
          logo: { thumbnailUrl: 'http://img.jpg' },
          screenshots: [],
          links: { websiteUrl: 'http://example.com' },
          authors: [{ name: 'Author1' }],
          categories: [{ name: 'Maps' }],
          dateModified: '2024-01-01',
          latestFiles: [{ id: 1, displayName: 'v1.0', modId: 123 }],
        }],
        pagination: { totalCount: 1 },
      });

      mockGet.mockImplementation((_opts: any, callback: any) => {
        const res = {
          statusCode: 200,
          on: jest.fn((event: string, handler: any) => {
            if (event === 'data') handler(responseData);
            if (event === 'end') handler();
            return res;
          }),
        };
        callback(res);
        return { on: jest.fn() };
      });

      await handlers['curseforge-search-mods'](
        { query: 'test', apiKey: 'valid-key', requestId: 'r1' },
        mockSender
      );

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'curseforge-search-mods',
        expect.objectContaining({
          success: true,
          mods: expect.arrayContaining([
            expect.objectContaining({ id: 123, name: 'Test Mod' }),
          ]),
          requestId: 'r1',
        }),
        mockSender
      );
    });

    it('should handle 401 unauthorized response', async () => {
      mockGet.mockImplementation((_opts: any, callback: any) => {
        const res = {
          statusCode: 401,
          on: jest.fn((event: string, handler: any) => {
            if (event === 'data') handler('{}');
            if (event === 'end') handler();
            return res;
          }),
        };
        callback(res);
        return { on: jest.fn() };
      });

      await handlers['curseforge-search-mods'](
        { query: 'test', apiKey: 'bad-key', requestId: 'r1' },
        mockSender
      );

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'curseforge-search-mods',
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('401'),
          requestId: 'r1',
        }),
        mockSender
      );
    });

    it('should handle 403 forbidden response', async () => {
      mockGet.mockImplementation((_opts: any, callback: any) => {
        const res = {
          statusCode: 403,
          on: jest.fn((event: string, handler: any) => {
            if (event === 'data') handler('{}');
            if (event === 'end') handler();
            return res;
          }),
        };
        callback(res);
        return { on: jest.fn() };
      });

      await handlers['curseforge-search-mods'](
        { query: 'test', apiKey: 'key', requestId: 'r1' },
        mockSender
      );

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'curseforge-search-mods',
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('403'),
        }),
        mockSender
      );
    });

    it('should handle 429 rate limit response', async () => {
      mockGet.mockImplementation((_opts: any, callback: any) => {
        const res = {
          statusCode: 429,
          on: jest.fn((event: string, handler: any) => {
            if (event === 'data') handler('{}');
            if (event === 'end') handler();
            return res;
          }),
        };
        callback(res);
        return { on: jest.fn() };
      });

      await handlers['curseforge-search-mods'](
        { query: 'test', apiKey: 'key', requestId: 'r1' },
        mockSender
      );

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'curseforge-search-mods',
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('429'),
        }),
        mockSender
      );
    });

    it('should handle network errors', async () => {
      mockGet.mockImplementation((_opts: any, _callback: any) => {
        const req = {
          on: jest.fn((event: string, handler: any) => {
            if (event === 'error') handler(new Error('ECONNRESET'));
            return req;
          }),
        };
        return req;
      });

      await handlers['curseforge-search-mods'](
        { query: 'test', apiKey: 'key', requestId: 'r1' },
        mockSender
      );

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'curseforge-search-mods',
        expect.objectContaining({ success: false }),
        mockSender
      );
    });
  });

  describe('curseforge-open-website', () => {
    it('should open default CurseForge URL', async () => {
      const { shell } = require('electron');
      (shell.openExternal as jest.Mock).mockResolvedValue(undefined);

      await handlers['curseforge-open-website']({}, mockSender);

      expect(shell.openExternal).toHaveBeenCalledWith('https://www.curseforge.com/ark-survival-ascended');
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'curseforge-open-website',
        { success: true },
        mockSender
      );
    });

    it('should open custom URL when provided', async () => {
      const { shell } = require('electron');
      (shell.openExternal as jest.Mock).mockResolvedValue(undefined);

      await handlers['curseforge-open-website']({ url: 'https://custom.url' }, mockSender);

      expect(shell.openExternal).toHaveBeenCalledWith('https://custom.url');
    });

    it('should handle open errors', async () => {
      const { shell } = require('electron');
      (shell.openExternal as jest.Mock).mockRejectedValue(new Error('Cannot open'));

      await handlers['curseforge-open-website']({}, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'curseforge-open-website',
        { success: false, error: 'Cannot open' },
        mockSender
      );
    });
  });

  describe('curseforge-get-mod', () => {
    it('should fail when no API key is provided', async () => {
      await handlers['curseforge-get-mod']({ modId: 123, requestId: 'r1' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'curseforge-get-mod',
        expect.objectContaining({ success: false, error: expect.stringContaining('API key') }),
        mockSender
      );
    });

    it('should fetch mod details successfully', async () => {
      const modData = JSON.stringify({
        data: {
          id: 123,
          name: 'Test Mod',
          summary: 'Summary',
          downloadCount: 500,
          logo: { thumbnailUrl: 'thumb.jpg' },
          screenshots: [{ thumbnailUrl: 'screen.jpg' }],
          links: { websiteUrl: 'http://example.com' },
          authors: [{ name: 'Author' }],
          categories: [{ name: 'Mods' }],
          dateModified: '2024-01-01',
        },
      });

      mockGet.mockImplementation((_opts: any, callback: any) => {
        const res = {
          statusCode: 200,
          on: jest.fn((event: string, handler: any) => {
            if (event === 'data') handler(modData);
            if (event === 'end') handler();
            return res;
          }),
        };
        callback(res);
        return { on: jest.fn() };
      });

      await handlers['curseforge-get-mod'](
        { modId: 123, apiKey: 'key', requestId: 'r1' },
        mockSender
      );

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'curseforge-get-mod',
        expect.objectContaining({
          success: true,
          mod: expect.objectContaining({ id: 123, name: 'Test Mod' }),
          requestId: 'r1',
        }),
        mockSender
      );
    });
  });
});
