import { getServerPortRanges } from './server-ports.utils';
import { DEFAULT_SERVER_PORT_RANGES } from './ark/port-sets';
import type { GlobalConfig } from './global-config.utils';
import type { DockerNetworkInfo } from './docker-network.utils';

describe('getServerPortRanges', () => {
  const config = (extra: Partial<GlobalConfig> = {}) => ({ webServerPort: 3000, ...extra }) as GlobalConfig;
  const custom = { game: { start: 7000, end: 7100 }, query: { start: 27000, end: 27010 }, rcon: { start: 27100, end: 27110 } };

  it('is the defaults until Settings sets them', () => {
    expect(getServerPortRanges(config(), null)).toEqual({ ranges: DEFAULT_SERVER_PORT_RANGES, source: 'settings' });
  });

  it('is what Settings saved', () => {
    expect(getServerPortRanges(config({ serverPorts: custom }), null)).toEqual({ ranges: custom, source: 'settings' });
  });

  // A hand-edited global-config.json must not leave servers with nowhere to go.
  it('falls back to the defaults when the saved ranges cannot be used', () => {
    const broken = { ...custom, game: { start: 7100, end: 7000 } };
    expect(getServerPortRanges(config({ serverPorts: broken }), null).ranges).toEqual(DEFAULT_SERVER_PORT_RANGES);
  });

  it('is what docker-compose.yml publishes in Docker, whatever Settings says', () => {
    const docker: DockerNetworkInfo = {
      mode: 'published', gamePorts: { start: 7777, end: 7800 }, queryPorts: { start: 27015, end: 27020 }, rconPorts: { start: 27020, end: 27030 }, webPort: 3000
    };
    expect(getServerPortRanges(config({ serverPorts: custom }), docker)).toEqual({
      ranges: { game: docker.gamePorts, query: docker.queryPorts, rcon: docker.rconPorts },
      source: 'docker'
    });
  });
});
