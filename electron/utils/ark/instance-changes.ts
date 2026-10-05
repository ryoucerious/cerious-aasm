import { EventEmitter } from 'events';

/**
 * Fires 'changed' after a server config is written or removed, so caches built from the configs
 * (the pool directory) can drop their copy. A separate module so that nothing that reads configs
 * has to import what listens.
 */
export const instanceChanges = new EventEmitter();

export function notifyInstancesChanged(): void {
  instanceChanges.emit('changed');
}
