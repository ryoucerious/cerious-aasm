import { sanitizeString } from '../utils/validation.utils';

/**
 * Message Routing Service
 * Handles message validation and routing for IPC communication
 */
export class MessageRoutingService {

  /**
   * Validate and process incoming message channel
   * @param channel - The message channel name
   * @returns ValidationResult with sanitized channel or error
   */
  validateChannel(channel: any): ChannelValidationResult {
    // Validate channel exists and is string
    if (!channel || typeof channel !== 'string') {
      return {
        valid: false,
        error: 'Invalid channel'
      };
    }
    
    // Sanitize channel name
    const sanitizedChannel = sanitizeString(channel);
    
    // Validate channel format (alphanumeric, hyphens, underscores only)
    if (!/^[a-zA-Z0-9_-]+$/.test(sanitizedChannel)) {
      return {
        valid: false,
        error: 'Invalid channel format'
      };
    }

    return {
      valid: true,
      sanitizedChannel
    };
  }

  /**
   * Create standardized message response
   * @param status - Response status
   * @param channel - Message channel
   * @param payload - Message payload
   * @param error - Error message if any
   * @returns Formatted message response
   */
  createMessageResponse(
    status: 'received' | 'error',
    channel?: string,
    payload?: any,
    error?: string
  ): MessageResponse {
    const response: MessageResponse = {
      status,
      transport: 'ipc'
    };

    if (error) {
      response.error = error;
    }

    if (channel) {
      response.channel = channel;
    }

    if (payload) {
      response.payload = payload;
      
      // Include requestId if present
      if (payload.requestId) {
        response.requestId = payload.requestId;
      }
    }

    return response;
  }
}

// Service Result Interfaces
export interface ChannelValidationResult {
  valid: boolean;
  sanitizedChannel?: string;
  error?: string;
}

export interface MessageResponse {
  status: 'received' | 'error';
  transport: 'ipc';
  channel?: string;
  payload?: any;
  error?: string;
  requestId?: string;
}