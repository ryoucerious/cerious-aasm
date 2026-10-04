import { jest } from '@jest/globals';

jest.mock('../utils/validation.utils', () => ({
  sanitizeString: jest.fn((s: string) => s.replace(/[<>"'&]/g, '')),
}));

describe('MessageRoutingService', () => {
  let MessageRoutingService: any;
  let service: any;

  beforeAll(() => {
    const mod = require('./message-routing.service');
    MessageRoutingService = mod.MessageRoutingService;
    service = new MessageRoutingService();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateChannel', () => {
    it('should validate a simple channel name', () => {
      const result = service.validateChannel('get-settings');

      expect(result.valid).toBe(true);
      expect(result.sanitizedChannel).toBe('get-settings');
    });

    it('should validate channel with underscores', () => {
      const result = service.validateChannel('server_status');

      expect(result.valid).toBe(true);
      expect(result.sanitizedChannel).toBe('server_status');
    });

    it('should validate alphanumeric channel', () => {
      const result = service.validateChannel('channel123');

      expect(result.valid).toBe(true);
    });

    it('should reject null channel', () => {
      const result = service.validateChannel(null);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid channel');
    });

    it('should reject undefined channel', () => {
      const result = service.validateChannel(undefined);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid channel');
    });

    it('should reject empty string channel', () => {
      const result = service.validateChannel('');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid channel');
    });

    it('should reject non-string channel', () => {
      const result = service.validateChannel(123);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid channel');
    });

    it('should reject channel with invalid characters', () => {
      const result = service.validateChannel('channel with spaces');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid channel format');
    });

    it('should reject channel with dots', () => {
      const result = service.validateChannel('channel.name');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid channel format');
    });

    it('should reject channel with slashes', () => {
      const result = service.validateChannel('channel/name');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid channel format');
    });
  });

  describe('createMessageResponse', () => {
    it('acknowledges delivery with the channel alone', () => {
      expect(service.createMessageResponse('received', 'my-channel')).toEqual({ status: 'received', channel: 'my-channel' });
    });

    it('reports an error', () => {
      expect(service.createMessageResponse('error', undefined, 'Something broke')).toEqual({ status: 'error', error: 'Something broke' });
    });
  });
});
