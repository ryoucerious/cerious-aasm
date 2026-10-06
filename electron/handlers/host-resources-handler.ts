import { sampleHostResources } from '../services/host-resources';
import { onRequest } from './handler.utils';

/** CPU, memory and disk of this machine, for the dashboard. A value that cannot be read is null. */
onRequest('get-host-resources', () => sampleHostResources(), { onError: error => ({ error }) });
