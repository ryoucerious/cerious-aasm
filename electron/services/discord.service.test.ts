import axios from 'axios';
import * as instanceUtils from '../utils/ark/instance.utils';
import { DiscordService, isDiscordWebhookUrl, validateDiscordConfig } from './discord.service';

jest.mock('axios');
jest.mock('../utils/ark/instance.utils', () => ({ getInstance: jest.fn() }));

const mockPost = jest.mocked(axios.post);
const mockGetInstance = jest.mocked(instanceUtils.getInstance);

const WEBHOOK = 'https://discord.com/api/webhooks/123/secret-token';

describe('DiscordService', () => {
  const service = new DiscordService();

  const baseInstance = {
    id: 'inst1',
    sessionName: 'Test Server',
    name: 'TestInstance',
    discordConfig: {
      enabled: true,
      webhookUrl: WEBHOOK,
      notifications: { serverStart: true, serverStop: true, serverCrash: true, serverUpdate: true, serverJoin: true, serverLeave: true }
    }
  };

  function withConfig(discordConfig: Record<string, unknown> | undefined) {
    mockGetInstance.mockReturnValue({ ...baseInstance, discordConfig });
  }

  beforeEach(() => {
    mockGetInstance.mockReturnValue(baseInstance);
    mockPost.mockResolvedValue({ status: 204 });
    jest.mocked(axios.isAxiosError).mockImplementation(error => !!(error as { isAxiosError?: boolean } | null)?.isAxiosError);
  });

  describe('sendNotification', () => {
    it('posts an embed to the webhook, giving up after 10 seconds', async () => {
      await service.sendNotification('inst1', 'start', 'Server starting');

      expect(mockPost).toHaveBeenCalledWith(
        WEBHOOK,
        expect.objectContaining({
          username: 'Cerious AASM',
          embeds: [expect.objectContaining({ title: 'Server Notification: Test Server', description: 'Server starting', color: 0x00FF00 })]
        }),
        { timeout: 10000 }
      );
    });

    it('accepts the older discordapp.com host', async () => {
      withConfig({ enabled: true, webhookUrl: 'https://discordapp.com/api/webhooks/123/secret-token' });

      await service.sendNotification('inst1', 'start', 'Hello');

      expect(mockPost).toHaveBeenCalled();
    });

    // The URL is user-supplied and posted to from the host: anything but Discord's own endpoint
    // made the app a request relay into the host's network.
    it('never posts to a URL that is not a Discord webhook', async () => {
      withConfig({ enabled: true, webhookUrl: 'http://192.168.1.1/admin' });

      await service.sendNotification('inst1', 'start', 'Hello');

      expect(mockPost).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('inst1'));
      expect(JSON.stringify(jest.mocked(console.warn).mock.calls)).not.toContain('192.168.1.1');
    });

    it.each([
      ['an unknown instance', null],
      ['Discord turned off', { ...baseInstance, discordConfig: { enabled: false, webhookUrl: WEBHOOK } }],
      ['no webhook URL', { ...baseInstance, discordConfig: { enabled: true, webhookUrl: '' } }],
      ['no Discord settings', { id: 'inst1', sessionName: 'Test' }]
    ])('sends nothing for %s', async (_label, instance) => {
      mockGetInstance.mockReturnValue(instance);

      await service.sendNotification('inst1', 'start', 'Hello');

      expect(mockPost).not.toHaveBeenCalled();
    });

    it('respects the per-event switches', async () => {
      withConfig({ ...baseInstance.discordConfig, notifications: { ...baseInstance.discordConfig.notifications, serverStart: false } });

      await service.sendNotification('inst1', 'start', 'Server starting');

      expect(mockPost).not.toHaveBeenCalled();
    });

    it('sends every event when no switches were saved', async () => {
      withConfig({ enabled: true, webhookUrl: WEBHOOK });

      await service.sendNotification('inst1', 'start', 'Hello');

      expect(mockPost).toHaveBeenCalled();
    });

    // A logged AxiosError carries the request config, and with it the webhook URL and its token.
    it('logs only the error message and HTTP status of a failed post', async () => {
      const failure = Object.assign(new Error('Request failed with status code 404'), {
        isAxiosError: true,
        config: { url: WEBHOOK, headers: {} },
        response: { status: 404, data: { message: 'Unknown Webhook' }, config: { url: WEBHOOK } }
      });
      mockPost.mockRejectedValue(failure);

      await expect(service.sendNotification('inst1', 'start', 'Hello')).resolves.toBeUndefined();

      const logged = JSON.stringify(jest.mocked(console.error).mock.calls);
      expect(logged).toContain('Request failed with status code 404');
      expect(logged).toContain('HTTP 404');
      expect(logged).not.toContain('secret-token');
    });

    it('logs a network failure without the URL', async () => {
      mockPost.mockRejectedValue(Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED', config: { url: WEBHOOK } }));

      await service.sendNotification('inst1', 'start', 'Hello');

      const logged = JSON.stringify(jest.mocked(console.error).mock.calls);
      expect(logged).toContain('timeout of 10000ms exceeded');
      expect(logged).not.toContain('secret-token');
    });

    it.each([
      ['start', 0x00FF00],
      ['stop', 0xFFA500],
      ['crash', 0xFF0000],
      ['update', 0x00FFFF],
      ['join', 0x00AA00],
      ['leave', 0xAA0000],
      ['unknown', 0x7289DA]
    ])('colours a %s event', async (event, color) => {
      await service.sendNotification('inst1', event, `Event: ${event}`);

      expect(mockPost).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ embeds: [expect.objectContaining({ color })] }), expect.anything());
    });

    it('names the server by its id when it has no name', async () => {
      mockGetInstance.mockReturnValue({ id: 'inst1', discordConfig: baseInstance.discordConfig });

      await service.sendNotification('inst1', 'start', 'Hello');

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ embeds: [expect.objectContaining({ title: 'Server Notification: inst1' })] }),
        expect.anything()
      );
    });
  });

  describe('isDiscordWebhookUrl', () => {
    it.each([
      WEBHOOK,
      'https://discordapp.com/api/webhooks/123/token',
      'https://DISCORD.com/api/webhooks/123/token',
      // Discord hands out webhook URLs on its test builds' hosts and with an API version too.
      'https://ptb.discord.com/api/webhooks/123/token',
      'https://canary.discord.com/api/webhooks/123/token',
      'https://canary.discordapp.com/api/webhooks/123/token',
      'https://discord.com/api/v10/webhooks/123/token'
    ])('accepts %p', url => {
      expect(isDiscordWebhookUrl(url)).toBe(true);
    });

    it.each([
      'http://discord.com/api/webhooks/123/token',
      'https://discord.com/api/v10/channels/123/messages',
      'https://discord.com.attacker.example/api/webhooks/123/token',
      'https://discord.com@attacker.example/api/webhooks/123/token',
      'https://user:pass@discord.com/api/webhooks/123/token',
      'https://discord.com:8443/api/webhooks/123/token',
      'https://attacker.example/api/webhooks/123/token?host=discord.com',
      'https://attacker.discord.com/api/webhooks/123/token',
      'https://ptb.discord.com.attacker.example/api/webhooks/123/token',
      'https://discord.com/api/vX/webhooks/123/token',
      'file:///etc/passwd',
      'not a url',
      '',
      undefined,
      42
    ])('refuses %p', url => {
      expect(isDiscordWebhookUrl(url)).toBe(false);
    });
  });

  describe('validateDiscordConfig', () => {
    it.each([
      undefined,
      null,
      { enabled: false, webhookUrl: '' },
      { enabled: false, webhookUrl: null },
      { enabled: true, webhookUrl: WEBHOOK }
    ])('accepts %p', config => {
      expect(validateDiscordConfig(config)).toBeUndefined();
    });

    // Refused at send time instead: an old URL must not block saving unrelated settings.
    it('accepts a URL that is already stored, whatever it is', () => {
      expect(validateDiscordConfig({ enabled: true, webhookUrl: 'https://hooks.example/x' }, 'https://hooks.example/x')).toBeUndefined();
    });

    it('checks a URL that differs from the stored one', () => {
      expect(validateDiscordConfig({ enabled: true, webhookUrl: 'https://hooks.example/y' }, 'https://hooks.example/x'))
        .toBe('The Discord webhook URL must be a Discord webhook link, such as https://discord.com/api/webhooks/...');
    });

    it.each([
      { enabled: true, webhookUrl: 'https://attacker.example/hook' },
      { enabled: false, webhookUrl: 'http://discord.com/api/webhooks/1/a' },
      { enabled: true, webhookUrl: 42 },
      'https://discord.com/api/webhooks/1/a'
    ])('refuses %p', config => {
      expect(validateDiscordConfig(config)).toBe('The Discord webhook URL must be a Discord webhook link, such as https://discord.com/api/webhooks/...');
    });
  });
});
