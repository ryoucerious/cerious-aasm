import { messagingService } from '../services/messaging.service';
import { whitelistService, WhitelistResult } from '../services/whitelist.service';
import { validateInstanceId } from '../utils/validation.utils';
import type { MessageSender } from '../types/messaging.types';
import { asPayload, errorMessage } from './handler.utils';
import { registerForwardable, routeToHost } from '../services/host-routing';

interface WhitelistRequest {
  needsPlayer: boolean;
  fallbackError: string;
  run(instanceId: string, playerId: string): WhitelistResult;
}

// These replies carry no requestId; the channel alone identifies them. The whitelist file is the
// hosting machine's: for a server on another machine of the mesh the request runs there.
function onWhitelistRequest(channel: string, { needsPlayer, fallbackError, run }: WhitelistRequest, read = false): void {
  const answer = (payload: unknown): Record<string, unknown> => {
    const { instanceId, playerId } = asPayload(payload);
    if (!instanceId || (needsPlayer && (!playerId || typeof playerId !== 'string'))) {
      return { success: false, error: needsPlayer ? 'Instance ID and Player ID are required' : 'Instance ID is required' };
    }
    if (!validateInstanceId(instanceId)) {
      return { success: false, error: 'Invalid instance ID' };
    }
    try {
      const result = run(instanceId, needsPlayer ? playerId.trim() : '');
      return { success: result.success, playerIds: result.playerIds || [], message: result.message, error: result.error };
    } catch (error) {
      console.error(`[whitelist-handler] ${channel} failed:`, error);
      return { success: false, error: errorMessage(error, fallbackError) };
    }
  };
  registerForwardable(channel, read, async payload => answer(payload));
  messagingService.on(channel, async (payload: unknown, sender: MessageSender) => {
    const reply = (data: Record<string, unknown>) => messagingService.sendToOriginator(channel, data, sender);
    const request = asPayload(payload);
    if (typeof request.instanceId === 'string' && request.instanceId) {
      try {
        const remote = await routeToHost(channel, request.instanceId, request, read, sender);
        if (remote !== null) {
          reply(remote as Record<string, unknown>);
          return;
        }
      } catch (error) {
        reply({ success: false, error: errorMessage(error, fallbackError) });
        return;
      }
    }
    reply(answer(payload));
  });
}

onWhitelistRequest('load-whitelist', {
  needsPlayer: false,
  fallbackError: 'Failed to load whitelist',
  run: instanceId => whitelistService.loadWhitelistFromInstance(instanceId)
}, true);

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
