import { messagingService } from '../services/messaging.service';
import { automationService } from '../services/automation/automation.service';

/**
 * Handles the 'configure-autostart' message event from the messaging service.
 * 
 * When triggered, this handler invokes the AutomationService to configure autostart settings.
 * It then sends the result back to the originator of the message, including details such as
 * success status and any error information.
 * In case of unexpected errors during the configuration, it logs the error and sends a failure
 * response to the originator.
 * 
 * @param payload - The payload received with the message, expected to contain `serverId`, 
 *                  `autoStartOnAppLaunch`, `autoStartOnBoot`, and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('configure-autostart', async (payload, sender) => {
  const { serverId, autoStartOnAppLaunch, autoStartOnBoot, requestId } = payload || {};
  
  try {
    const result = await automationService.configureAutostart(serverId, autoStartOnAppLaunch, autoStartOnBoot);
    
    messagingService.sendToOriginator('configure-autostart', {
      ...result,
      requestId
    }, sender);
  } catch (error) {
    console.error('[automation-handler] Error configuring autostart:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    messagingService.sendToOriginator('configure-autostart', {
      success: false,
      error: errorMsg,
      requestId
    }, sender);
  }
});

/**
 * Handles the 'configure-crash-detection' message event from the messaging service.
 * 
 * When triggered, this handler invokes the AutomationService to configure crash detection settings.
 * It then sends the result back to the originator of the message, including details such as
 * success status and any error information.
 * In case of unexpected errors during the configuration, it logs the error and sends a failure
 * response to the originator.
 * 
 * @param payload - The payload received with the message, expected to contain `serverId`, 
 *                  `enabled`, `checkInterval`, `maxRestartAttempts`, and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('configure-crash-detection', async (payload, sender) => {
  const { serverId, enabled, checkInterval, maxRestartAttempts, requestId } = payload || {};
  
  try {
    const result = await automationService.configureCrashDetection(serverId, enabled, checkInterval, maxRestartAttempts);
    
    messagingService.sendToOriginator('configure-crash-detection', {
      ...result,
      requestId
    }, sender);
  } catch (error) {
    console.error('[automation-handler] Error configuring crash detection:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    messagingService.sendToOriginator('configure-crash-detection', {
      success: false,
      error: errorMsg,
      requestId
    }, sender);
  }
});

/**
 * Configure Discord Webhook Integration
 */
messagingService.on('configure-discord-webhook', async (payload, sender) => {
  const { serverId, config, requestId } = payload || {};
  try {
    const { instanceUtils } = require('../utils/ark/instance.utils');
    const instance = await instanceUtils.getInstance(serverId);
    if (!instance) throw new Error('Instance not found');

    instance.discordConfig = config;
    await instanceUtils.saveInstance(instance);

    messagingService.sendToOriginator('configure-discord-webhook', { success: true, requestId }, sender);
  } catch (error) {
    console.error('[automation-handler] Error configuring discord:', error);
    messagingService.sendToOriginator('configure-discord-webhook', { 
      success: false, 
      error: (error as Error).message, 
      requestId 
    }, sender);
  }
});

/**
 * Configure Scheduled Broadcasts
 */
messagingService.on('configure-broadcasts', async (payload, sender) => {
  const { serverId, broadcasts, requestId } = payload || {};
  try {
    const { instanceUtils } = require('../utils/ark/instance.utils');
    const { schedulerService } = require('../services/scheduler.service');
    
    const instance = await instanceUtils.getInstance(serverId);
    if (!instance) throw new Error('Instance not found');

    instance.broadcasts = broadcasts;
    await instanceUtils.saveInstance(instance);
    
    // Update live scheduler
    schedulerService.updateBroadcasts(serverId, broadcasts);
    schedulerService.initSchedule(serverId);

    messagingService.sendToOriginator('configure-broadcasts', { success: true, requestId }, sender);
  } catch (error) {
    console.error('[automation-handler] Error configuring broadcasts:', error);
    messagingService.sendToOriginator('configure-broadcasts', { 
      success: false, 
      error: (error as Error).message, 
      requestId 
    }, sender);
  }
});

/**
 * Handles the 'configure-scheduled-restart' message event from the messaging service.
 * 
 * When triggered, this handler invokes the AutomationService to configure scheduled restart settings.
 * It then sends the result back to the originator of the message, including details such as
 * success status and any error information.
 * In case of unexpected errors during the configuration, it logs the error and sends a failure
 * response to the originator.
 * 
 * @param payload - The payload received with the message, expected to contain `serverId`, 
 *                  `enabled`, `frequency`, `time`, `days`, `warningMinutes`, and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('configure-scheduled-restart', async (payload, sender) => {
  const { serverId, enabled, frequency, time, days, warningMinutes, requestId } = payload || {};
  
  try {
    const result = await automationService.configureScheduledRestart(serverId, enabled, frequency, time, days, warningMinutes);
    
    messagingService.sendToOriginator('configure-scheduled-restart', {
      ...result,
      requestId
    }, sender);
  } catch (error) {
    console.error('[automation-handler] Error configuring scheduled restart:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    messagingService.sendToOriginator('configure-scheduled-restart', {
      success: false,
      error: errorMsg,
      requestId
    }, sender);
  }
});

/**
 * Handles the 'get-automation-status' message event from the messaging service.
 * 
 * When triggered, this handler invokes the AutomationService to retrieve the current automation status.
 * It then sends the result back to the originator of the message, including details such as
 * the current status and any error information.
 * In case of unexpected errors during the status retrieval, it logs the error and sends a failure
 * response to the originator.
 * 
 * @param payload - The payload received with the message, expected to contain `serverId` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('get-automation-status', async (payload, sender) => {
  const { serverId, requestId } = payload || {};
  
  try {
    const result = await automationService.getAutomationStatus(serverId);
    
    messagingService.sendToOriginator('get-automation-status', {
      ...result,
      requestId
    }, sender);
  } catch (error) {
    console.error('[automation-handler] Error getting automation status:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    messagingService.sendToOriginator('get-automation-status', {
      success: false,
      error: errorMsg,
      requestId
    }, sender);
  }
});

/**
 * Handles the 'auto-start-on-app-launch' message event from the messaging service.
 * 
 * When triggered, this handler invokes the AutomationService to configure auto-start on app launch.
 * It then sends the result back to the originator of the message, including details such as
 * success status and any error information.
 * In case of unexpected errors during the configuration, it logs the error and sends a failure
 * response to the originator.
 * 
 * @param payload - The payload received with the message, expected to contain `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('auto-start-on-app-launch', async (payload, sender) => {
  const { requestId } = payload || {};
  
  try {
    await automationService.handleAutoStartOnAppLaunch();
    
    messagingService.sendToOriginator('auto-start-on-app-launch', {
      success: true,
      requestId
    }, sender);
  } catch (error) {
    console.error('[automation-handler] Error during auto-start on app launch:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    messagingService.sendToOriginator('auto-start-on-app-launch', {
      success: false,
      error: errorMsg,
      requestId
    }, sender);
  }
});
