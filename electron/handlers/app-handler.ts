import { onRequest } from './handler.utils';
import { getLogFilePath } from '../utils/logger';

onRequest('get-log-file-path', () => ({ path: getLogFilePath() }));
