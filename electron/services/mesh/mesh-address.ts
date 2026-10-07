import type { MeshAddress } from '../../types/mesh.types';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HOST_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * The address other machines use to reach a member, as typed in: a public IPv4 address or a
 * host name (such as a dynamic DNS name), and the outside ports, which a port forward can make
 * differ from the ones the member listens on. Throws with a message for the person typing it.
 */
export function meshAddressOf(input: { host?: unknown; peerPort?: unknown; raftPort?: unknown }): MeshAddress {
  const host = String(input.host ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  if (!host) throw new Error('Enter the address other machines use to reach this one: an IPv4 address or a host name.');
  if (host.includes(':')) {
    if (/^[^:]+:\d+$/.test(host)) throw new Error('Enter the address without a port. The ports have boxes of their own.');
    throw new Error('Use an IPv4 address or a host name. IPv6 addresses are not supported yet.');
  }
  const octets = IPV4.exec(host);
  if (octets) {
    if (octets.slice(1).some(octet => Number(octet) > 255)) throw new Error(`"${host}" is not an IPv4 address or a host name.`);
    if (host === '0.0.0.0') throw new Error('0.0.0.0 is not an address another machine can reach this one at.');
  } else if (!HOST_NAME.test(host) || /^[\d.]+$/.test(host)) {
    throw new Error(`"${host}" is not an IPv4 address or a host name.`);
  }
  return {
    host,
    peerPort: portOf(input.peerPort, 'connection'),
    raftPort: portOf(input.raftPort, 'database')
  };
}

function portOf(value: unknown, which: string): number {
  const port = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`The ${which} port must be a whole number from 1 to 65535.`);
  }
  return port;
}

const MEMBER_URL_HELP = 'Enter the address of a machine already in the mesh, such as https://ark.example.com:4747.';
const DEFAULT_PEER_PORT = 4747;

/**
 * The URL of a member to join through, from what was typed or pasted: https:// and port 4747
 * are added when left out, and http:// becomes https://, since members only speak TLS.
 */
export function memberUrlOf(typed: string): string {
  let text = String(typed ?? '').trim().replace(/\/+$/, '');
  if (/^http:\/\//i.test(text)) text = text.replace(/^http:\/\//i, 'https://');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(MEMBER_URL_HELP);
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !host || (url.pathname && url.pathname !== '/') || /\s/.test(typed.trim())) {
    throw new Error(MEMBER_URL_HELP);
  }
  return `https://${host}:${url.port || DEFAULT_PEER_PORT}`;
}

/** What other machines dial for the peer API. */
export function peerUrlFor(address: MeshAddress): string {
  return `https://${address.host}:${address.peerPort}`;
}

/** What other machines dial for Raft. */
export function raftAddrFor(address: MeshAddress): string {
  return `${address.host}:${address.raftPort}`;
}

/** A member's address, from the peer URL and Raft address it is recorded with. */
export function addressFromEndpoints(peerUrl: string, raftAddr: string): MeshAddress | null {
  try {
    const url = new URL(peerUrl);
    const peerPort = Number(url.port || 443);
    const raftPort = Number(raftAddr.slice(raftAddr.lastIndexOf(':') + 1));
    if (!url.hostname || !Number.isInteger(raftPort) || raftPort < 1) return null;
    return { host: url.hostname, peerPort, raftPort };
  } catch {
    return null;
  }
}
