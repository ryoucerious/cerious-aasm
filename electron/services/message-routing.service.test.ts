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
    it('should create basic received response', () => {
      const response = service.createMessageResponse('received');

      expect(response.status).toBe('received');
      expect(response.transport).toBe('ipc');
      expect(response.error).toBeUndefined();
    });

    it('should create error response with message', () => {
      const response = service.createMessageResponse('error', undefined, undefined, 'Something broke');

      expect(response.status).toBe('error');
      expect(response.error).toBe('Something broke');
    });

    it('should include channel when provided', () => {
      const response = service.createMessageResponse('received', 'test-channel');

      expect(response.channel).toBe('test-channel');
    });

    it('should include payload when provided', () => {
      const response = service.createMessageResponse('received', 'ch', { data: 'test' });

      expect(response.payload).toEqual({ data: 'test' });
    });

    it('should extract requestId from payload', () => {
      const response = service.createMessageResponse('received', 'ch', { requestId: 'req123', data: 'x' });

      expect(response.requestId).toBe('req123');
    });

    it('should not include requestId when payload has none', () => {
      const response = service.createMessageResponse('received', 'ch', { data: 'x' });

      expect(response.requestId).toBeUndefined();
    });

    it('should handle all parameters at once', () => {
      const response = service.createMessageResponse(
        'received',
        'my-channel',
        { requestId: 'r1', value: 42 },
        undefined
      );

      expect(response).toEqual({
        status: 'received',
        transport: 'ipc',
        channel: 'my-channel',
        payload: { requestId: 'r1', value: 42 },
        requestId: 'r1',
      });
    });
  });
});
