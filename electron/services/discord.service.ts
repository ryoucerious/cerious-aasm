import axios from 'axios';
import * as instanceUtils from '../utils/ark/instance.utils';
import { DiscordWebhookConfig } from '../types/server-instance.types';

// Discord's release, public test and canary builds, on the current and the older domain.
const WEBHOOK_HOST = /^((ptb|canary)\.)?discord(app)?\.com$/;
// '/api/webhooks/...', or with an API version: '/api/v10/webhooks/...'.
const WEBHOOK_PATH = /^\/api\/(v\d+\/)?webhooks\//;
const REQUEST_TIMEOUT_MS = 10000;
const INVALID_WEBHOOK_URL = 'The Discord webhook URL must be a Discord webhook link, such as https://discord.com/api/webhooks/...';

/**
 * Only Discord's own webhook endpoint: the URL is user-supplied and posted to from the host, so
 * anything else would make the app a relay into the host's network.
 */
export function isDiscordWebhookUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:'
    && WEBHOOK_HOST.test(parsed.hostname)
    && parsed.port === ''
    && !parsed.username
    && !parsed.password
    && WEBHOOK_PATH.test(parsed.pathname);
}

/**
 * Why a Discord config from a client may not be saved, or undefined when it may. No URL is fine, and
 * so is `storedUrl` unchanged: sendNotification refuses that one, and it must not block other edits.
 */
export function validateDiscordConfig(config: unknown, storedUrl?: unknown): string | undefined {
  if (config === undefined || config === null) return undefined;
  if (typeof config !== 'object') return INVALID_WEBHOOK_URL;
  const { webhookUrl } = config as { webhookUrl?: unknown };
  if (webhookUrl === undefined || webhookUrl === null || webhookUrl === '' || webhookUrl === storedUrl) return undefined;
  return isDiscordWebhookUrl(webhookUrl) ? undefined : INVALID_WEBHOOK_URL;
}

export class DiscordService {
  /** Posts `message` to the instance's webhook if it has one and wants `eventType`. Never rejects. */
  async sendNotification(instanceId: string, eventType: string, message: string): Promise<void> {
    try {
      const instance = instanceUtils.getInstance(instanceId);
      const discordConfig: DiscordWebhookConfig | undefined = instance?.discordConfig;
      if (!discordConfig?.enabled || !discordConfig.webhookUrl || !this.shouldSendNotification(discordConfig, eventType)) {
        return;
      }
      // Checked again here: a config.json edited by hand or written by an older version is not
      // validated on save.
      if (!isDiscordWebhookUrl(discordConfig.webhookUrl)) {
        console.warn(`[discord] Not notifying for ${instanceId}: its webhook URL is not a Discord webhook`);
        return;
      }

      const serverName = instance?.sessionName || instance?.name || instanceId;
      const payload = {
        username: 'Cerious AASM',
        avatar_url: 'https://i.imgur.com/4M34hi2.png',
        embeds: [{
          title: `Server Notification: ${serverName}`,
          description: message,
          color: this.getEventColor(eventType),
          timestamp: new Date().toISOString(),
          footer: { text: `Instance: ${instanceId}` }
        }]
      };

      await axios.post(discordConfig.webhookUrl, payload, { timeout: REQUEST_TIMEOUT_MS });
    } catch (error) {
      // Never the error itself: an AxiosError carries the request, and the webhook URL is its token.
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[discord] Webhook for ${instanceId} failed: ${reason}${status ? ` (HTTP ${status})` : ''}`);
    }
  }

  // A missing switch means the event is sent.
  private shouldSendNotification(config: DiscordWebhookConfig, eventType: string): boolean {
    const notifications = config.notifications;
    if (!notifications) return true;

    switch (eventType) {
      case 'start': return notifications.serverStart !== false;
      case 'stop': return notifications.serverStop !== false;
      case 'crash': return notifications.serverCrash !== false;
      case 'update': return notifications.serverUpdate !== false;
      case 'join': return notifications.serverJoin !== false;
      case 'leave': return notifications.serverLeave !== false;
      default: return true;
    }
  }

  private getEventColor(eventType: string): number {
    switch (eventType) {
      case 'start': return 0x00FF00;
      case 'stop': return 0xFFA500;
      case 'crash': return 0xFF0000;
      case 'update': return 0x00FFFF;
      case 'join': return 0x00AA00;
      case 'leave': return 0xAA0000;
      default: return 0x7289DA;
    }
  }
}

export const discordService = new DiscordService();
