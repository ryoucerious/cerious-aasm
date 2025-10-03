import { messagingService } from '../services/messaging.service';
import { whitelistService } from '../services/whitelist.service';
import { serverOperationsService } from '../services/server-instance/server-operations.service';
import { getInstancesBaseDir } from '../utils/ark/instance.utils';
import * as path from 'path';

/**
 * Whitelist Handler - Manages whitelist-related message events
 */

/**
 * Load whitelist for a specific instance
 */
messagingService.on('load-whitelist', async (payload, sender) => {
  try {
    const { instanceId } = payload;
    
    if (!instanceId) {
      messagingService.sendToOriginator('load-whitelist', {
        success: false,
        error: 'Instance ID is required'
      }, sender);
      return;
    }

    const instanceDir = path.join(getInstancesBaseDir(), instanceId);
    const result = whitelistService.loadWhitelistFromInstance(instanceDir);

    messagingService.sendToOriginator('load-whitelist', {
      success: result.success,
      playerIds: result.playerIds || [],
      message: result.message,
      error: result.error
    }, sender);

  } catch (error) {
    console.error('[whitelist-handler] Failed to load whitelist:', error);
    messagingService.sendToOriginator('load-whitelist', {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load whitelist'
    }, sender);
  }
});

/**
 * Add player to whitelist
 */
messagingService.on('add-to-whitelist', async (payload, sender) => {
  try {
    const { instanceId, playerId } = payload;
    
    if (!instanceId || !playerId) {
      messagingService.sendToOriginator('add-to-whitelist', {
        success: false,
        error: 'Instance ID and Player ID are required'
      }, sender);
      return;
    }

    const instanceDir = path.join(getInstancesBaseDir(), instanceId);
    const result = whitelistService.addToInstanceWhitelist(instanceDir, playerId.trim());

    messagingService.sendToOriginator('add-to-whitelist', {
      success: result.success,
      playerIds: result.playerIds || [],
      message: result.message,
      error: result.error
    }, sender);

  } catch (error) {
    console.error('[whitelist-handler] Failed to add player to whitelist:', error);
    messagingService.sendToOriginator('add-to-whitelist', {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add player to whitelist'
    }, sender);
  }
});

/**
 * Remove player from whitelist
 */
messagingService.on('remove-from-whitelist', async (payload, sender) => {
  try {
    const { instanceId, playerId } = payload;
    
    if (!instanceId || !playerId) {
      messagingService.sendToOriginator('remove-from-whitelist', {
        success: false,
        error: 'Instance ID and Player ID are required'
      }, sender);
      return;
    }

    const instanceDir = path.join(getInstancesBaseDir(), instanceId);
    const result = whitelistService.removeFromInstanceWhitelist(instanceDir, playerId.trim());

    messagingService.sendToOriginator('remove-from-whitelist', {
      success: result.success,
      playerIds: result.playerIds || [],
      message: result.message,
      error: result.error
    }, sender);

  } catch (error) {
    console.error('[whitelist-handler] Failed to remove player from whitelist:', error);
    messagingService.sendToOriginator('remove-from-whitelist', {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove player from whitelist'
    }, sender);
  }
});

/**
 * Clear entire whitelist
 */
messagingService.on('clear-whitelist', async (payload, sender) => {
  try {
    const { instanceId } = payload;
    
    if (!instanceId) {
      messagingService.sendToOriginator('clear-whitelist', {
        success: false,
        error: 'Instance ID is required'
      }, sender);
      return;
    }

    const instanceDir = path.join(getInstancesBaseDir(), instanceId);
    const result = whitelistService.clearInstanceWhitelist(instanceDir);

    messagingService.sendToOriginator('clear-whitelist', {
      success: result.success,
      playerIds: result.playerIds || [],
      message: result.message,
      error: result.error
    }, sender);

  } catch (error) {
    console.error('[whitelist-handler] Failed to clear whitelist:', error);
    messagingService.sendToOriginator('clear-whitelist', {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to clear whitelist'
    }, sender);
  }
});

console.log('[whitelist-handler] Whitelist message handlers registered');