import { allPortSets, nextPortSet, portSet, portsMatchSet, reconcilePortSets } from './port-sets';

describe('port sets', () => {
  it('builds 25 sets ten ports apart from the ASA defaults', () => {
    const sets = allPortSets();
    expect(sets).toHaveLength(25);
    expect(sets[0]).toEqual({ index: 1, gamePort: 7777, peerPort: 7778, queryPort: 27015, rconPort: 27020 });
    expect(sets[1]).toEqual({ index: 2, gamePort: 7787, peerPort: 7788, queryPort: 27025, rconPort: 27030 });
    expect(sets[24]).toEqual({ index: 25, gamePort: 8017, peerPort: 8018, queryPort: 27255, rconPort: 27260 });
    expect(() => portSet(26)).toThrow();
  });

  it('treats only a complete set as taken', () => {
    expect(portsMatchSet(7777, 27015, 27020)).toBe(true);
    expect(portsMatchSet(8888, 28015, 28020)).toBe(false);
    expect(portsMatchSet(7777, 27015, 28999)).toBe(false);
    expect(nextPortSet([8888, 9999])?.gamePort).toBe(7777);
    expect(nextPortSet([7777, 7787])?.index).toBe(3);
  });

  it('assigns the earliest names first and leaves a server that is already on a set', () => {
    const { instances, changedIds } = reconcilePortSets([
      { id: 'b', name: 'CP second', gamePort: 9999, queryPort: 28099, rconPort: 28998 },
      { id: 'a', name: 'Calmaria Playthrough', gamePort: 7777, queryPort: 27015, rconPort: 27020 }
    ]);
    expect(instances.find(server => server.id === 'a')).toMatchObject({ gamePort: 7777, queryPort: 27015, rconPort: 27020 });
    expect(instances.find(server => server.id === 'b')).toMatchObject({ gamePort: 7787, queryPort: 27025, rconPort: 27030 });
    expect(changedIds).toEqual(['b']);
  });
});
