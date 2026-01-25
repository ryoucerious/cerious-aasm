import axios from 'axios';
import * as instanceUtils from '../utils/ark/instance.utils';

export interface DiscordWebhookConfig {
  enabled: boolean;
  webhookUrl: string;
  notifications: {
    serverStart: boolean;
    serverStop: boolean;
    serverCrash: boolean;
    serverUpdate: boolean;
    serverJoin: boolean;
    serverLeave: boolean;
  }
}

export class DiscordService {
  
  /**
   * Send a notification to Discord via Webhook
   * @param instanceId - Server Instance ID
   * @param eventType - Type of event (start, stop, crash, update, join, leave)
   * @param message - The message description
   * @param details - Optional details (e.g. Build ID, Player Name)
   */
  async sendNotification(instanceId: string, eventType: string, message: string, details?: string): Promise<void> {
    try {
      const instance = await instanceUtils.getInstance(instanceId);
      if (!instance) return;

      // Check if Discord settings exist and feature is enabled
      const discordConfig: DiscordWebhookConfig = instance.discordConfig;
      if (!discordConfig || !discordConfig.enabled || !discordConfig.webhookUrl) return;

      // Check if this specific event type is enabled
      if (!this.shouldSendNotification(discordConfig, eventType)) return;

      const serverName = instance.sessionName || instance.name || instanceId;
      const color = this.getErrorColor(eventType);
      
      const payload = {
        username: "Cerious AASM",
        avatar_url: "https://i.imgur.com/4M34hi2.png", // Generic server icon or app icon
        embeds: [{
          title: `Server Notification: ${serverName}`,
          description: message,
          color: color,
          fields: details ? [{ name: "Details", value: details }] : [],
          timestamp: new Date().toISOString(),
          footer: {
            text: `Instance: ${instanceId}`
          }
        }]
      };

      await axios.post(discordConfig.webhookUrl, payload);
      
    } catch (error) {
      console.error(`[discord-service] Failed to send webhook for ${instanceId}:`, error);
    }
  }

  private shouldSendNotification(config: DiscordWebhookConfig, eventType: string): boolean {
    if (!config.notifications) return true; // Default to true if detailed settings missing

    switch (eventType) {
      case 'start': return config.notifications.serverStart !== false;
      case 'stop': return config.notifications.serverStop !== false;
      case 'crash': return config.notifications.serverCrash !== false;
      case 'update': return config.notifications.serverUpdate !== false;
      case 'join': return config.notifications.serverJoin !== false;
      case 'leave': return config.notifications.serverLeave !== false;
      default: return true;
    }
  }

  private getErrorColor(eventType: string): number {
    switch (eventType) {
      case 'start': return 0x00FF00; // Green
      case 'stop': return 0xFFA500; // Orange
      case 'crash': return 0xFF0000; // Red
      case 'update': return 0x00FFFF; // Cyan
      case 'join': return 0x00AA00; // Dark Green
      case 'leave': return 0xAA0000; // Dark Red
      default: return 0x7289DA; // Blurple
    }
  }
}

export const discordService = new DiscordService();
