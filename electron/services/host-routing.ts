import type { MessageSender } from '../types/messaging.types';

/**
 * Requests about a server, run on the machine of the mesh that hosts it. The pages of a server on
 * another machine (its backups, automation and the rest) send their requests to the machine they
 * are open on; the request is passed to the hosting machine, which runs the same handler, and its
 * answer comes back unchanged.
 */

/** Answers for the hosting machine, or null when the server is hosted here (or there is no mesh). */
export type HostRouter = (
  channel: string,
  serverId: string,
  payload: Record<string, unknown>,
  read: boolean,
  sender: MessageSender
) => Promise<unknown | null>;

let router: HostRouter | null = null;

/** Set by the mesh once it runs; null outside a mesh. */
export function setHostRouter(next: HostRouter | null): void {
  router = next;
}

export function routeToHost(
  channel: string,
  serverId: string,
  payload: Record<string, unknown>,
  read: boolean,
  sender: MessageSender
): Promise<unknown | null> {
  return router ? router(channel, serverId, payload, read, sender) : Promise.resolve(null);
}

/** The requests another machine may pass here, by channel; a read may also come without quorum. */
const forwardable = new Map<string, { read: boolean; run: (payload: Record<string, unknown>) => Promise<unknown> }>();

export function registerForwardable(channel: string, read: boolean, run: (payload: Record<string, unknown>) => Promise<unknown>): void {
  forwardable.set(channel, { read, run });
}

/**
 * Host side: runs a request another machine passed here. Only the channels that opted in, and a
 * change never as a read: a read comes as a query, which is not logged and needs no quorum.
 */
export async function runForwardedRequest(channel: string, payload: Record<string, unknown>, read: boolean): Promise<unknown> {
  const entry = forwardable.get(channel);
  if (!entry || (read && !entry.read)) throw new Error(`${channel} cannot be run for another machine.`);
  return entry.run(payload);
}
