import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { messagingService } from '../services/messaging.service';
import { MessageRoutingService } from '../services/message-routing.service';
import { errorMessage } from './handler.utils';

const messageRoutingService = new MessageRoutingService();

// The renderer's way onto the bus. The reply only acknowledges delivery and never echoes the
// payload, which can hold backup uploads and passwords.
ipcMain.handle('message', (event: IpcMainInvokeEvent, request?: unknown) => {
  try {
    const { channel, payload } = (request ?? {}) as { channel?: unknown; payload?: unknown };
    const validation = messageRoutingService.validateChannel(channel);
    if (!validation.valid || !validation.sanitizedChannel) {
      return messageRoutingService.createMessageResponse('error', undefined, validation.error);
    }

    messagingService.emit(validation.sanitizedChannel, payload, event.sender);
    return messageRoutingService.createMessageResponse('received', validation.sanitizedChannel);
  } catch (error) {
    console.error('[message-handler] Unexpected error:', error);
    return messageRoutingService.createMessageResponse('error', undefined, errorMessage(error));
  }
});
