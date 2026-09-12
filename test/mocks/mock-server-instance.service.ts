import { of } from 'rxjs';

export class MockServerInstanceService {
  getInstances = () => ({ subscribe: () => {} });
  getInstancesOnce = () => Promise.resolve([]);
  getActiveServer = () => of(null);
  shutdownAllServers = () => Promise.resolve();
  save = () => ({ pipe: () => ({ subscribe: () => {} }) });
  importServerFromBackup = () => ({ pipe: () => ({ subscribe: () => {} }) });
  delete = () => ({ pipe: () => ({ subscribe: () => {} }) });
  reorderServers = () => ({ pipe: () => ({ subscribe: () => {} }) });
  setActiveServer = () => {};
  getDefaultInstanceFromMeta = () => ({ pipe: () => ({ subscribe: () => {} }) });
  messaging = { receiveMessage: () => ({ subscribe: () => {} }), sendMessage: () => ({ subscribe: () => {} }) };
  // Add other public methods as needed
}
