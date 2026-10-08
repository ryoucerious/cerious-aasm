import { onRequest } from './handler.utils';
import { getLogFilePath } from '../utils/logger';
import { applicationService } from '../services/application.service';
import { runAtStartupStatus, setRunAtStartup } from '../services/run-at-startup.service';

onRequest('get-log-file-path', () => ({ path: getLogFilePath() }));

// Starting the app when someone logs in to this computer; not in Docker, nor without a window.
onRequest('get-run-at-startup', () => runAtStartupStatus({ headless: applicationService.isHeadless() }));
onRequest('set-run-at-startup', payload => setRunAtStartup(payload.enabled === true, { headless: applicationService.isHeadless() }));
