// Mock the services
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
  },
}));

jest.mock('../services/message-routing.service', () => ({
  MessageRoutingService: jest.fn(),
}));

jest.mock('../services/messaging.service', () => ({
  messagingService: {
    emit: jest.fn(),
  },
}));

import { ipcMain } from 'electron';
import { MessageRoutingService } from '../services/message-routing.service';
import { messagingService } from '../services/messaging.service';

// Capture handler registrations
const handlerMap: Record<string, Function> = {};
(ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
  handlerMap[channel] = handler;
});

// Setup MessageRoutingService mock instance and force the handler to use it
const mockMessageRoutingServiceInstance = {
  validateChannel: jest.fn(),
  createMessageResponse: jest.fn()
};
(MessageRoutingService as unknown as jest.Mock).mockImplementation(() => mockMessageRoutingServiceInstance);

// Import after mocking so handlerMap is populated and handler uses our mock
import './message-handler';

const mockMessagingService = messagingService as jest.Mocked<typeof messagingService>;

describe('message-handler', () => {
  let mockEvent: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockEvent = { sender: {} };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should register IPC handler for message channel', () => {
    expect(typeof handlerMap['message']).toBe('function');
  });

  it('should handle valid channel successfully', async () => {
    const validChannel = 'test-channel';
    const payload = { data: 'test' };

    mockMessageRoutingServiceInstance.validateChannel.mockReturnValue({
      valid: true,
      sanitizedChannel: validChannel
    });

    mockMessageRoutingServiceInstance.createMessageResponse.mockReturnValue({
      status: 'received',
      transport: 'ipc',
      channel: validChannel,
      payload
    });

    const result = await handlerMap['message'](mockEvent, { channel: validChannel, payload });

    expect(mockMessageRoutingServiceInstance.validateChannel).toHaveBeenCalledWith(validChannel);
    expect(mockMessagingService.emit).toHaveBeenCalledWith(validChannel, payload, mockEvent.sender);
    expect(mockMessageRoutingServiceInstance.createMessageResponse).toHaveBeenCalledWith('received', validChannel, payload);
    expect(result).toEqual({
      status: 'received',
      transport: 'ipc',
      channel: validChannel,
      payload
    });
  });

  it('should handle invalid channel', async () => {
    const invalidChannel = 'invalid-channel';
    const payload = { data: 'test' };
    const validationError = 'Invalid channel format';

    mockMessageRoutingServiceInstance.validateChannel.mockReturnValue({
      valid: false,
      error: validationError
    });

    mockMessageRoutingServiceInstance.createMessageResponse.mockReturnValue({
      status: 'error',
      transport: 'ipc',
      error: validationError
    });

    const result = await handlerMap['message'](mockEvent, { channel: invalidChannel, payload });

    expect(mockMessageRoutingServiceInstance.validateChannel).toHaveBeenCalledWith(invalidChannel);
    expect(mockMessagingService.emit).not.toHaveBeenCalled();
    expect(mockMessageRoutingServiceInstance.createMessageResponse).toHaveBeenCalledWith('error', undefined, undefined, validationError);
    expect(result).toEqual({
      status: 'error',
      transport: 'ipc',
      error: validationError
    });
  });

  it('should handle unexpected errors', async () => {
    const validChannel = 'test-channel';
    const payload = { data: 'test' };
    const errorMessage = 'Unexpected error occurred';

    mockMessageRoutingServiceInstance.validateChannel.mockImplementation(() => {
      throw new Error(errorMessage);
    });

    mockMessageRoutingServiceInstance.createMessageResponse.mockReturnValue({
      status: 'error',
      transport: 'ipc',
      error: errorMessage
    });

    const result = await handlerMap['message'](mockEvent, { channel: validChannel, payload });

    expect(mockMessageRoutingServiceInstance.validateChannel).toHaveBeenCalledWith(validChannel);
    expect(mockMessagingService.emit).not.toHaveBeenCalled();
    expect(mockMessageRoutingServiceInstance.createMessageResponse).toHaveBeenCalledWith('error', undefined, undefined, errorMessage);
    expect(result).toEqual({
      status: 'error',
      transport: 'ipc',
      error: errorMessage
    });
  });

  it('should handle non-Error exceptions', async () => {
    const validChannel = 'test-channel';
    const payload = { data: 'test' };

    mockMessageRoutingServiceInstance.validateChannel.mockImplementation(() => {
      throw 'String error';
    });

    mockMessageRoutingServiceInstance.createMessageResponse.mockReturnValue({
      status: 'error',
      transport: 'ipc',
      error: 'Unexpected error'
    });

    const result = await handlerMap['message'](mockEvent, { channel: validChannel, payload });

    expect(mockMessageRoutingServiceInstance.validateChannel).toHaveBeenCalledWith(validChannel);
    expect(mockMessagingService.emit).not.toHaveBeenCalled();
    expect(mockMessageRoutingServiceInstance.createMessageResponse).toHaveBeenCalledWith('error', undefined, undefined, 'Unexpected error');
    expect(result).toEqual({
      status: 'error',
      transport: 'ipc',
      error: 'Unexpected error'
    });
  });
});