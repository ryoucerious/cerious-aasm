import { findPortConflict, nextFreePortSet, portSet, PORT_SET_COUNT } from './port-sets';

describe('port-sets', () => {
  describe('portSet', () => {
    it('spaces the sets ten apart from the ASA defaults', () => {
      expect(portSet(1)).toEqual({ gamePort: 7777, peerPort: 7778, queryPort: 27015, rconPort: 27020 });
      expect(portSet(3)).toEqual({ gamePort: 7797, peerPort: 7798, queryPort: 27035, rconPort: 27040 });
    });
  });

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

  describe('nextFreePortSet', () => {
    it('gives the first server the default set', () => {
      expect(nextFreePortSet([])).toEqual(portSet(1));
    });

    it('gives the lowest set no other server touches', () => {
      expect(nextFreePortSet([{ gamePort: 7777, queryPort: 27015, rconPort: 27020 }])).toEqual(portSet(2));
    });

    it('skips a set that a custom configuration overlaps', () => {
      // Game 7787 is set 2's game port, so set 2 is unusable even though its other ports are free.
      expect(nextFreePortSet([{ gamePort: 7787, queryPort: 27015, rconPort: 27020 }])).toEqual(portSet(3));
    });

    it('returns null once every set is taken', () => {
      const all = Array.from({ length: PORT_SET_COUNT }, (_, i) => portSet(i + 1));
      expect(nextFreePortSet(all)).toBeNull();
    });
  });
});
