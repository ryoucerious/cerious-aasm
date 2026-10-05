import { platformService } from '../services/platform.service';
import { onRequest } from './handler.utils';

onRequest('get-system-info', () => ({
  nodeVersion: platformService.getNodeVersion(),
  electronVersion: platformService.getElectronVersion(),
  platform: platformService.getPlatform(),
  configPath: platformService.getConfigPath()
}), { onError: error => ({ error }) });
