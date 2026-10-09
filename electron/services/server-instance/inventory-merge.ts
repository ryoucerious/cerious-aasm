import type { InstanceConfig } from '../../types/server-instance.types';

type InventoryMerge = (instances: InstanceConfig[]) => Promise<InstanceConfig[]>;
let mergeInventory: InventoryMerge | null = null;

/** Mesh installs add the other machines' servers to every list this process broadcasts. */
export function setInventoryMerge(merge: InventoryMerge | null): void {
  mergeInventory = merge;
}

export async function mergeWithInventory(instances: InstanceConfig[]): Promise<InstanceConfig[]> {
  return mergeInventory ? mergeInventory(instances) : instances;
}
