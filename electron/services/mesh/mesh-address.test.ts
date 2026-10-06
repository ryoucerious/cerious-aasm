import { addressFromEndpoints, meshAddressOf, peerUrlFor, raftAddrFor } from './mesh-address';

describe('mesh addresses', () => {
  describe('an address typed in', () => {
    it('takes a public IPv4 address or a host name, with the outside ports', () => {
      expect(meshAddressOf({ host: ' 203.0.113.5 ', peerPort: '4747', raftPort: 4002 })).toEqual({ host: '203.0.113.5', peerPort: 4747, raftPort: 4002 });
      expect(meshAddressOf({ host: 'Mesh.Example-1.duckdns.org', peerPort: 14747, raftPort: 14002 }))
        .toEqual({ host: 'mesh.example-1.duckdns.org', peerPort: 14747, raftPort: 14002 });
    });

    it('takes an address pasted with https:// in front, or a slash after', () => {
      expect(meshAddressOf({ host: 'https://mesh.example.org/', peerPort: 4747, raftPort: 4002 }).host).toBe('mesh.example.org');
    });

    it.each([
      ['nothing', '', 'Enter the address other machines use to reach this one: an IPv4 address or a host name.'],
      ['a port in the address', 'mesh.example.org:4747', 'Enter the address without a port. The ports have boxes of their own.'],
      ['an IPv6 address', '2001:db8::1', 'Use an IPv4 address or a host name. IPv6 addresses are not supported yet.'],
      ['an address no machine can dial', '0.0.0.0', '0.0.0.0 is not an address another machine can reach this one at.'],
      ['an address out of range', '300.1.2.3', '"300.1.2.3" is not an IPv4 address or a host name.'],
      ['spaces in a name', 'my mesh.org', '"my mesh.org" is not an IPv4 address or a host name.'],
      ['a path', 'mesh.example.org/x', '"mesh.example.org/x" is not an IPv4 address or a host name.']
    ])('refuses %s', (_label, host, error) => {
      expect(() => meshAddressOf({ host, peerPort: 4747, raftPort: 4002 })).toThrow(error);
    });

    it.each([
      [{ peerPort: 0, raftPort: 4002 }, 'The connection port must be a whole number from 1 to 65535.'],
      [{ peerPort: 4747, raftPort: 70000 }, 'The database port must be a whole number from 1 to 65535.'],
      [{ peerPort: 'abc', raftPort: 4002 }, 'The connection port must be a whole number from 1 to 65535.']
    ])('refuses a port out of range: %p', (ports, error) => {
      expect(() => meshAddressOf({ host: 'mesh.example.org', ...ports })).toThrow(error);
    });
  });

  it('gives the peer URL and Raft address other machines dial', () => {
    const address = { host: 'mesh.example.org', peerPort: 14747, raftPort: 14002 };

    expect(peerUrlFor(address)).toBe('https://mesh.example.org:14747');
    expect(raftAddrFor(address)).toBe('mesh.example.org:14002');
  });

  it('reads the address back from a member\'s record', () => {
    expect(addressFromEndpoints('https://192.168.1.155:4747', '192.168.1.155:4002')).toEqual({ host: '192.168.1.155', peerPort: 4747, raftPort: 4002 });
    expect(addressFromEndpoints('not a url', '')).toBeNull();
  });
});
