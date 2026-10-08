import { DEFAULT_SERVER_PORT_RANGES, findPortConflict, nextFreePortsIn, parseServerPortRanges, portsOutsideRanges } from './port-sets';

describe('port-sets', () => {
  describe('findPortConflict', () => {
    const other = { name: 'Island', gamePort: 7777, queryPort: 27015, rconPort: 27020 };

    it('returns null when nothing overlaps', () => {
      expect(findPortConflict({ gamePort: 7787, queryPort: 27025, rconPort: 27030 }, [other])).toBeNull();
    });

    it('reports a game port another server already uses', () => {
      expect(findPortConflict({ gamePort: 7777, queryPort: 27025, rconPort: 27030 }, [other]))
        .toEqual({ port: 7777, protocol: 'UDP', name: 'Island' });
    });

    it('reports a game port that is another server\'s peer port', () => {
      expect(findPortConflict({ gamePort: 7778, queryPort: 27025, rconPort: 27030 }, [other]))
        .toEqual({ port: 7778, protocol: 'UDP', name: 'Island' });
    });

    it('reports a peer port that another server\'s game port sits on', () => {
      expect(findPortConflict({ gamePort: 7776, queryPort: 27025, rconPort: 27030 }, [other]))
        .toEqual({ port: 7777, protocol: 'UDP', name: 'Island' });
    });

    it('reports a shared RCON port', () => {
      expect(findPortConflict({ gamePort: 7787, queryPort: 27025, rconPort: 27020 }, [other]))
        .toEqual({ port: 27020, protocol: 'TCP', name: 'Island' });
    });

    it('keeps UDP and TCP apart: a query port equal to another server\'s RCON port is fine', () => {
      expect(findPortConflict({ gamePort: 7787, queryPort: 27020, rconPort: 27030 }, [other])).toBeNull();
    });

    it('treats missing ports as the ASA defaults and accepts strings', () => {
      expect(findPortConflict({ gamePort: '7787', rconPort: '27030' }, [{ name: 'Bare' }]))
        .toEqual({ port: 27015, protocol: 'UDP', name: 'Bare' });
    });
  });

  // Every machine has ranges its servers' ports come from: what its firewall opens, or what Docker
  // publishes. A new server takes the lowest free ports inside them.
  describe('nextFreePortsIn', () => {
    const ranges = DEFAULT_SERVER_PORT_RANGES;

    it('gives the first server the bottom of each range', () => {
      expect(nextFreePortsIn(ranges, [])).toEqual({ gamePort: 7777, peerPort: 7778, queryPort: 27015, rconPort: 27020 });
    });

    it('takes the lowest ports no other server uses', () => {
      expect(nextFreePortsIn(ranges, [{ gamePort: 7777, queryPort: 27015, rconPort: 27020 }]))
        .toEqual({ gamePort: 7779, peerPort: 7780, queryPort: 27016, rconPort: 27021 });
    });

    it('fills a gap a removed server left', () => {
      const others = [{ gamePort: 7777, queryPort: 27015, rconPort: 27020 }, { gamePort: 7781, queryPort: 27017, rconPort: 27022 }];
      expect(nextFreePortsIn(ranges, others)).toEqual({ gamePort: 7779, peerPort: 7780, queryPort: 27016, rconPort: 27021 });
    });

    it("treats another server's missing ports as the ASA defaults", () => {
      expect(nextFreePortsIn(ranges, [{ name: 'Bare' }]))
        .toEqual({ gamePort: 7779, peerPort: 7780, queryPort: 27016, rconPort: 27021 });
    });

    it('keeps the peer port inside the game range', () => {
      const tight = { ...ranges, game: { start: 7777, end: 7779 } };
      expect(nextFreePortsIn(tight, [{ gamePort: 7777 }])).toBeNull();
    });

    it('keeps the query port off the game and peer ports it chose', () => {
      const sharing = { ...ranges, game: { start: 7777, end: 7800 }, query: { start: 7778, end: 7790 } };
      expect(nextFreePortsIn(sharing, [])).toEqual(expect.objectContaining({ gamePort: 7777, queryPort: 7779 }));
    });

    it('returns null once a range is full', () => {
      const oneQuery = { ...ranges, query: { start: 27015, end: 27015 } };
      expect(nextFreePortsIn(oneQuery, [{ gamePort: 7777, queryPort: 27015, rconPort: 27020 }])).toBeNull();
    });
  });

  describe('portsOutsideRanges', () => {
    const ranges = DEFAULT_SERVER_PORT_RANGES;

    it('finds nothing when every port is inside', () => {
      expect(portsOutsideRanges({ gamePort: 7777, queryPort: 27015, rconPort: 27020 }, ranges)).toEqual([]);
    });

    it('reports a game port outside, and the peer port with it', () => {
      expect(portsOutsideRanges({ gamePort: 7967, queryPort: 27015, rconPort: 27020 }, ranges)).toEqual([
        { label: 'Game', port: 7967, protocol: 'UDP', range: ranges.game },
        { label: 'Peer', port: 7968, protocol: 'UDP', range: ranges.game }
      ]);
    });

    it('reports a peer port pushed past the top of the game range', () => {
      expect(portsOutsideRanges({ gamePort: 7900, queryPort: 27015, rconPort: 27020 }, ranges))
        .toEqual([{ label: 'Peer', port: 7901, protocol: 'UDP', range: ranges.game }]);
    });

    it('reports query and RCON ports outside theirs', () => {
      expect(portsOutsideRanges({ gamePort: 7777, queryPort: '27100', rconPort: 27100 }, ranges)).toEqual([
        { label: 'Query', port: 27100, protocol: 'UDP', range: ranges.query },
        { label: 'RCON', port: 27100, protocol: 'TCP', range: ranges.rcon }
      ]);
    });

    it('counts missing ports as the ASA defaults', () => {
      expect(portsOutsideRanges({}, ranges)).toEqual([]);
    });
  });

  describe('parseServerPortRanges', () => {
    const input = { game: { start: 7777, end: 7900 }, query: { start: 27015, end: 27030 }, rcon: { start: 27020, end: 27050 } };

    it('defaults to the ranges docker-compose.yml publishes', () => {
      expect(DEFAULT_SERVER_PORT_RANGES).toEqual(input);
    });

    it('accepts numbers or numeric strings', () => {
      expect(parseServerPortRanges({ ...input, game: { start: '7777', end: '7800' } }))
        .toEqual({ ranges: { ...input, game: { start: 7777, end: 7800 } } });
    });

    it('needs all three ranges', () => {
      expect(parseServerPortRanges({ game: input.game })).toEqual({ error: 'Give a range for the game, query and RCON ports.' });
    });

    it('refuses a range that ends before it starts', () => {
      expect(parseServerPortRanges({ ...input, query: { start: 27030, end: 27015 } })).toEqual({ error: 'The query ports end before they start.' });
    });

    it('refuses ports outside 1 to 65535', () => {
      expect(parseServerPortRanges({ ...input, rcon: { start: 0, end: 70000 } })).toEqual({ error: 'Ports run from 1 to 65535.' });
    });

    it('needs room in the game range for the peer port', () => {
      expect(parseServerPortRanges({ ...input, game: { start: 7777, end: 7777 } }))
        .toEqual({ error: 'The game ports need at least two ports: each server also uses the one after its game port.' });
    });

    it('refuses game and query ranges that overlap, both being UDP', () => {
      expect(parseServerPortRanges({ ...input, query: { start: 7890, end: 7950 } }))
        .toEqual({ error: 'The game and query ports overlap. Both are UDP, so each needs a range of its own.' });
    });

    it('lets the query and RCON ranges overlap: one is UDP, the other TCP', () => {
      expect(parseServerPortRanges(input)).toEqual({ ranges: input });
    });
  });
});
