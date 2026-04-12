import { jest } from '@jest/globals';

jest.mock('axios');
jest.mock('../utils/ark/instance.utils', () => ({
  getInstance: jest.fn(),
}));

import axios from 'axios';
import * as instanceUtils from '../utils/ark/instance.utils';

const mockAxios = axios as jest.Mocked<typeof axios>;
const mockInstanceUtils = instanceUtils as jest.Mocked<typeof instanceUtils>;

describe('DiscordService', () => {
  let DiscordService: any;
  let service: any;

  beforeAll(() => {
    const mod = require('./discord.service');
    DiscordService = mod.DiscordService;
    service = new DiscordService();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendNotification', () => {
    const baseInstance = {
      sessionName: 'Test Server',
      name: 'TestInstance',
      discordConfig: {
        enabled: true,
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
        notifications: {
          serverStart: true,
          serverStop: true,
          serverCrash: true,
          serverUpdate: true,
          serverJoin: true,
          serverLeave: true,
        },
      },
    };

    it('should send notification on server start', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue(baseInstance);
      (mockAxios.post as jest.Mock<any>).mockResolvedValue({ status: 200 });

      await service.sendNotification('inst1', 'start', 'Server starting');

      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/123/abc',
        expect.objectContaining({
          username: 'Cerious AASM',
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: expect.stringContaining('Test Server'),
              description: 'Server starting',
              color: 0x00FF00, // Green for start
            }),
          ]),
        })
      );
    });

    it('should include details field when provided', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue(baseInstance);
      (mockAxios.post as jest.Mock<any>).mockResolvedValue({ status: 200 });

      await service.sendNotification('inst1', 'update', 'Server updated', 'Build ID: 12345');

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              fields: [{ name: 'Details', value: 'Build ID: 12345' }],
            }),
          ]),
        })
      );
    });

    it('should not send when instance not found', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue(null);

      await service.sendNotification('missing', 'start', 'Hello');

      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it('should not send when discord is disabled', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue({
        ...baseInstance,
        discordConfig: { enabled: false, webhookUrl: 'https://webhook' },
      });

      await service.sendNotification('inst1', 'start', 'Hello');

      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it('should not send when webhookUrl is empty', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue({
        ...baseInstance,
        discordConfig: { enabled: true, webhookUrl: '' },
      });

      await service.sendNotification('inst1', 'start', 'Hello');

      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it('should not send when no discordConfig', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue({
        sessionName: 'Test',
      });

      await service.sendNotification('inst1', 'start', 'Hello');

      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it('should respect individual notification toggles', async () => {
      const instance = {
        ...baseInstance,
        discordConfig: {
          ...baseInstance.discordConfig,
          notifications: {
            ...baseInstance.discordConfig.notifications,
            serverStart: false,
          },
        },
      };
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue(instance);

      await service.sendNotification('inst1', 'start', 'Server starting');

      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it('should handle axios errors gracefully', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue(baseInstance);
      (mockAxios.post as jest.Mock<any>).mockRejectedValue(new Error('Network error'));

      // Should not throw
      await service.sendNotification('inst1', 'start', 'Hello');

      expect(console.error).toHaveBeenCalled();
    });

    it('should use correct colors for different event types', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue(baseInstance);
      (mockAxios.post as jest.Mock<any>).mockResolvedValue({ status: 200 });

      const colorMap: Record<string, number> = {
        start: 0x00FF00,
        stop: 0xFFA500,
        crash: 0xFF0000,
        update: 0x00FFFF,
        join: 0x00AA00,
        leave: 0xAA0000,
      };

      for (const [event, expectedColor] of Object.entries(colorMap)) {
        jest.clearAllMocks();
        (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue(baseInstance);
        (mockAxios.post as jest.Mock<any>).mockResolvedValue({ status: 200 });

        await service.sendNotification('inst1', event, `Event: ${event}`);

        expect(mockAxios.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({ color: expectedColor }),
            ]),
          })
        );
      }
    });

    it('should default to blurple for unknown event types', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue(baseInstance);
      (mockAxios.post as jest.Mock<any>).mockResolvedValue({ status: 200 });

      await service.sendNotification('inst1', 'unknown', 'Test');

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({ color: 0x7289DA }),
          ]),
        })
      );
    });

    it('should default notifications to true when config missing', async () => {
      const instance = {
        ...baseInstance,
        discordConfig: {
          enabled: true,
          webhookUrl: 'https://webhook',
          // No notifications object
        },
      };
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue(instance);
      (mockAxios.post as jest.Mock<any>).mockResolvedValue({ status: 200 });

      await service.sendNotification('inst1', 'start', 'Hello');

      expect(mockAxios.post).toHaveBeenCalled();
    });

    it('should use instanceId as fallback server name', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue({
        discordConfig: baseInstance.discordConfig,
        // No sessionName or name
      });
      (mockAxios.post as jest.Mock<any>).mockResolvedValue({ status: 200 });

      await service.sendNotification('inst1', 'start', 'Hello');

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: expect.stringContaining('inst1'),
            }),
          ]),
        })
      );
    });
  });
});
