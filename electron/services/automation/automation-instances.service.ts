import { getAllInstances } from '../../utils/ark/instance.utils';
import type { InstanceConfig } from '../../types/server-instance.types';
import { ServerAutomation } from '../../types/automation.types';
import { createServerAutomation } from './automation-defaults';

export class AutomationInstancesService {
  private automations: Map<string, ServerAutomation>;

  constructor(automations: Map<string, ServerAutomation>) {
    this.automations = automations;
  }

  /** One record per instance, from its config.json, so every saved schedule is re-armed at startup. */
  async loadAutomationFromInstances(): Promise<void> {
    try {
      const instances: Array<InstanceConfig | null> = await getAllInstances();
      for (const instance of Array.isArray(instances) ? instances : []) {
        if (instance?.id) {
          this.automations.set(instance.id, createServerAutomation(instance.id, instance));
        }
      }
    } catch (error) {
      console.error('[automation-instances] Failed to load automation settings:', error);
    }
  }
}