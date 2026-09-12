import { jest } from '@jest/globals';

jest.mock('../services/messaging.service', () => ({
  messagingService: {
    on: jest.fn(),
    sendToOriginator: jest.fn(),
  },
}));

jest.mock('../services/player-history.service', () => ({
  playerHistoryService: {
    getSamples: jest.fn(),
  },
}));

import { messagingService } from '../services/messaging.service';
import { playerHistoryService } from '../services/player-history.service';

const mockMessaging = messagingService as jest.Mocked<typeof messagingService>;
const mockHistory = playerHistoryService as jest.Mocked<typeof playerHistoryService>;

describe('player-history-handler', () => {
  let handler: (payload: any, sender: any) => void;
  const sender = { id: 's' };

  beforeAll(() => {
    require('./player-history-handler');
    handler = (mockMessaging.on as jest.Mock).mock.calls.find(call => call[0] === 'get-player-history')?.[1] as any;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns the recorded samples with the sampling interval', () => {
    const samples = [{ t: 1, counts: { a: 2 } }];
    mockHistory.getSamples.mockReturnValue(samples);

    handler({ requestId: 'req' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-player-history', {
      samples,
      intervalMs: 60_000,
      requestId: 'req'
    }, sender);
  });

  it('returns an empty list and the error when the service throws', () => {
    mockHistory.getSamples.mockImplementation(() => { throw new Error('boom'); });

    handler({ requestId: 'req2' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-player-history', {
      error: 'boom',
      samples: [],
      requestId: 'req2'
    }, sender);
  });

  it('tolerates a missing payload', () => {
    mockHistory.getSamples.mockReturnValue([]);
    handler(undefined, sender);
    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-player-history', expect.objectContaining({ samples: [], requestId: undefined }), sender);
  });
});
