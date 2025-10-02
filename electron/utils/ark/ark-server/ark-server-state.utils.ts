// --- Instance State Management ---
const instanceStates: Record<string, string> = {};

export function setInstanceState(instanceId: string, state: string) {
  instanceStates[instanceId] = state;
}

export function getInstanceState(instanceId: string): string | null {
  const state = instanceStates[instanceId] || null;
  return state;
}

/**
 * Get normalized instance state, mapping unknown/null to 'stopped'
 */
export function getNormalizedInstanceState(instanceId: string): string {
  const rawState = getInstanceState(instanceId);
  // Map unknown/null states to 'stopped' for better UX
  return rawState || 'stopped';
}

// --- Server Process Management ---
export const arkServerProcesses: Record<string, import('child_process').ChildProcess> = {};