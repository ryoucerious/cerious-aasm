import { messagingService } from '../services/messaging.service';
import { whitelistService, WhitelistResult } from '../services/whitelist.service';
import { validateInstanceId } from '../utils/validation.utils';
import type { MessageSender } from '../types/messaging.types';
import { asPayload, errorMessage } from './handler.utils';

interface WhitelistRequest {
  needsPlayer: boolean;
  fallbackError: string;
  run(instanceId: string, playerId: string): WhitelistResult;
}

// These replies carry no requestId; the channel alone identifies them.
function onWhitelistRequest(channel: string, { needsPlayer, fallbackError, run }: WhitelistRequest): void {
  messagingService.on(channel, (payload: unknown, sender: MessageSender) => {
    const reply = (data: Record<string, unknown>) => messagingService.sendToOriginator(channel, data, sender);
    const { instanceId, playerId } = asPayload(payload);

    if (!instanceId || (needsPlayer && (!playerId || typeof playerId !== 'string'))) {
      reply({ success: false, error: needsPlayer ? 'Instance ID and Player ID are required' : 'Instance ID is required' });
      return;
    }
    if (!validateInstanceId(instanceId)) {
      reply({ success: false, error: 'Invalid instance ID' });
      return;
    }

    try {
      const result = run(instanceId, needsPlayer ? playerId.trim() : '');
      reply({ success: result.success, playerIds: result.playerIds || [], message: result.message, error: result.error });
    } catch (error) {
      console.error(`[whitelist-handler] ${channel} failed:`, error);
      reply({ success: false, error: errorMessage(error, fallbackError) });
    }
  });
}

onWhitelistRequest('load-whitelist', {
  needsPlayer: false,
  fallbackError: 'Failed to load whitelist',
  run: instanceId => whitelistService.loadWhitelistFromInstance(instanceId)
});

onWhitelistRequest('add-to-whitelist', {
  needsPlayer: true,
  fallbackError: 'Failed to add player to whitelist',
  run: (instanceId, playerId) => whitelistService.addToInstanceWhitelist(instanceId, playerId)
});

onWhitelistRequest('remove-from-whitelist', {
  needsPlayer: true,
  fallbackError: 'Failed to remove player from whitelist',
  run: (instanceId, playerId) => whitelistService.removeFromInstanceWhitelist(instanceId, playerId)
});

onWhitelistRequest('clear-whitelist', {
  needsPlayer: false,
  fallbackError: 'Failed to clear whitelist',
  run: instanceId => whitelistService.clearInstanceWhitelist(instanceId)
});
