import { getDockerNetworkInfo, parsePortRange } from './docker-network.utils';

describe('parsePortRange', () => {
  const fallback = { start: 1, end: 2 };

  it('reads a range', () => {
    expect(parsePortRange('7777-7900', fallback)).toEqual({ start: 7777, end: 7900 });
  });

  it('reads a single port as a range of one', () => {
    expect(parsePortRange(' 27020 ', fallback)).toEqual({ start: 27020, end: 27020 });
  });

  it('falls back when unset', () => {
    expect(parsePortRange(undefined, fallback)).toBe(fallback);
    expect(parsePortRange('', fallback)).toBe(fallback);
  });

  it('falls back on anything that is not a valid port range', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['abc', '7900-7777', '0-10', '7777-70000', '7777:7900']) {
      expect(parsePortRange(bad, fallback)).toBe(fallback);
    }
    warn.mockRestore();
  });
});

describe('getDockerNetworkInfo', () => {
  it('is null outside Docker', () => {
    expect(getDockerNetworkInfo(false, {})).toBeNull();
  });

  it('defaults to the ranges docker-compose.yml publishes', () => {
    expect(getDockerNetworkInfo(true, {})).toEqual({
      mode: 'published',
      gamePorts: { start: 7777, end: 7900 },
      queryPorts: { start: 27015, end: 27030 },
      rconPorts: { start: 27020, end: 27050 },
      webPort: 3000
    });
  });

  it('reads the ranges and web port that compose passes in', () => {
    const info = getDockerNetworkInfo(true, {
      AASM_GAME_PORTS: '7777-7790',
      AASM_QUERY_PORTS: '27015-27020',
      AASM_RCON_PORTS: '27025',
      AASM_PORT: '8080'
    });
    expect(info).toEqual({
      mode: 'published',
      gamePorts: { start: 7777, end: 7790 },
      queryPorts: { start: 27015, end: 27020 },
      rconPorts: { start: 27025, end: 27025 },
      webPort: 8080
    });
  });

  it('reports host networking when the host override is used', () => {
    expect(getDockerNetworkInfo(true, { AASM_NETWORK: 'host' })?.mode).toBe('host');
    expect(getDockerNetworkInfo(true, { AASM_NETWORK: 'HOST' })?.mode).toBe('host');
    expect(getDockerNetworkInfo(true, { AASM_NETWORK: 'bridge' })?.mode).toBe('published');
  });
});
