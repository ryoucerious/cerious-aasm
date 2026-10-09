import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';

export interface ProbeResult {
  ok: boolean;
  rttMs: number;
  error?: string;
}

export function probeTcp(host: string, port: number, timeoutMs = 2000): Promise<ProbeResult> {
  const started = Date.now();
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const finish = (ok: boolean, error?: string) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({ ok, rttMs: Date.now() - started, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, 'Timed out'));
    socket.once('error', error => finish(false, error.message));
  });
}

/** Rough skew: positive means the peer clock is ahead of ours. */
export function clockSkewMs(peerNow: number, localNow = Date.now()): number {
  return peerNow - localNow;
}

export interface WireguardPeer {
  publicKey: string;
  endpoint: string;
  allowedIps: string;
}

/** A config the operator can apply. The mesh protocol does not require WireGuard. */
export function wireguardConfig(input: {
  privateKey: string;
  address: string;
  listenPort: number;
  peers: WireguardPeer[];
}): string {
  const peers = input.peers.map(peer => [
    '[Peer]',
    `PublicKey = ${peer.publicKey}`,
    `Endpoint = ${peer.endpoint}`,
    `AllowedIPs = ${peer.allowedIps}`
  ].join('\n')).join('\n\n');
  return [
    '[Interface]',
    `PrivateKey = ${input.privateKey}`,
    `Address = ${input.address}`,
    `ListenPort = ${input.listenPort}`,
    '',
    peers
  ].filter(Boolean).join('\n');
}

/** 32 random bytes, base64, which is the WireGuard private-key shape. */
export function wireguardPrivateKey(): string {
  return randomBytes(32).toString('base64');
}

export function wgInstalled(): Promise<boolean> {
  return new Promise(resolve => {
    execFile('wg', ['--version'], { windowsHide: true, timeout: 3000 }, error => resolve(!error));
  });
}

/**
 * Applies a config only when `wg-quick` is installed. The mesh protocol does not depend on it.
 * `installed` and `run` are injectable so tests do not touch a real interface.
 */
export async function applyWireguard(
  config: string,
  options: { installed?: boolean; run?: (file: string) => Promise<void> } = {}
): Promise<{ applied: boolean; error?: string }> {
  const installed = options.installed ?? await wgInstalled();
  if (!installed) {
    return { applied: false, error: 'WireGuard is not installed on this host. The mesh does not require it.' };
  }
  const file = path.join(os.tmpdir(), `aasm-wg-${Date.now()}.conf`);
  fs.writeFileSync(file, config, { mode: 0o600 });
  try {
    if (options.run) await options.run(file);
    else await new Promise<void>((resolve, reject) => {
      execFile('wg-quick', ['up', file], { windowsHide: true, timeout: 15000 }, error => error ? reject(error) : resolve());
    });
    return { applied: true };
  } catch (error) {
    return { applied: false, error: error instanceof Error ? error.message : 'WireGuard did not apply the config.' };
  } finally {
    try { fs.unlinkSync(file); } catch { /* already removed */ }
  }
}
