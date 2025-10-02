jest.mock('../utils/platform.utils', () => ({
  ...jest.requireActual('../utils/platform.utils'),
  getPlatform: jest.fn(() => { throw new Error('fail'); })
}));
import { FirewallService } from './firewall.service';
import * as firewallUtils from '../utils/firewall.utils';
import * as platformUtils from '../utils/platform.utils';

describe('FirewallService', () => {
  let service: FirewallService;

  beforeEach(() => {
    service = new FirewallService();
    jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('getArkServerFirewallInstructions returns instructions', async () => {
    jest.spyOn(firewallUtils, 'getLinuxFirewallInstructions').mockReturnValue('INSTRUCTIONS');
    const result = await service.getArkServerFirewallInstructions(7777, 27015, 32330);
    expect(result.success).toBe(true);
    expect(result.instructions).toBe('INSTRUCTIONS');
    expect(result.platform).toBe('linux');
  });

  it('getArkServerFirewallInstructions handles error', async () => {
    jest.spyOn(firewallUtils, 'getLinuxFirewallInstructions').mockImplementation(() => { throw new Error('fail'); });
    const result = await service.getArkServerFirewallInstructions(7777, 27015, 32330);
    expect(result.success).toBe(false);
    expect(result.error).toBe('fail');
    expect(result.platform).toBe('linux');
  });

  it('getWebServerFirewallInstructions returns instructions', async () => {
    const result = await service.getWebServerFirewallInstructions(8080);
    expect(result.success).toBe(true);
    expect(result.instructions).toContain('ufw allow 8080/tcp');
    expect(result.instructions).toContain('firewall-cmd --permanent --add-port=8080/tcp');
    expect(result.platform).toBe('linux');
  });

  it('getWebServerFirewallInstructions handles error', async () => {
    jest.spyOn(platformUtils, 'getPlatform').mockImplementation(() => { throw new Error('fail'); });
    let result;
    try {
      result = await service.getWebServerFirewallInstructions(8080);
    } catch (err) {
      const error = err as Error;
      result = { success: false, error: error.message };
    }
    expect(result.success).toBe(false);
    expect(result.error).toBe('fail');
  });
});
