import { EventEmitter } from 'events';

// Crash detection reacts to the exit itself, not only to its next poll, which can be minutes away.
const events = new EventEmitter();
// One listener per AutomationService, and tests make many.
events.setMaxListeners(0);

/** Calls `listener` with the id of each server whose process exits while starting or running. */
export function onServerCrashed(listener: (instanceId: string) => void): () => void {
  const safe = (instanceId: string) => {
    try {
      listener(instanceId);
    } catch (error) {
      console.error(`[crash-events] A crash listener failed for ${instanceId}:`, error);
    }
  };
  events.on('crashed', safe);
  return () => events.off('crashed', safe);
}

export function emitServerCrashed(instanceId: string): void {
  events.emit('crashed', instanceId);
}
