import { sanitizeString } from '../utils/validation.utils';

export interface ChannelValidationResult {
  valid: boolean;
  sanitizedChannel?: string;
  error?: string;
}

/** Acknowledges that a message reached the bus; the answer itself arrives on the channel. */
export interface MessageResponse {
  status: 'received' | 'error';
  channel?: string;
  error?: string;
}

export class MessageRoutingService {
  validateChannel(channel: unknown): ChannelValidationResult {
    if (!channel || typeof channel !== 'string') {
      return { valid: false, error: 'Invalid channel' };
    }

    const sanitizedChannel = sanitizeString(channel);
    if (!/^[a-zA-Z0-9_-]+$/.test(sanitizedChannel)) {
      return { valid: false, error: 'Invalid channel format' };
    }

    return { valid: true, sanitizedChannel };
  }

  createMessageResponse(status: MessageResponse['status'], channel?: string, error?: string): MessageResponse {
    const response: MessageResponse = { status };
    if (channel) {
      response.channel = channel;
    }
    if (error) {
      response.error = error;
    }
    return response;
  }
}
