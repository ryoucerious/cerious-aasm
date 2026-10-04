import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { messagingService } from '../services/messaging.service';
import { parsePort } from '../utils/validation.utils';
import type { ChildToMainMessage } from '../types/messaging.types';
import { sessionAuth } from './auth-middleware';
import { setupAuthRoutes } from './auth-routes';
import { setupIPCHandlers } from './ipc-handlers';
import { installSocketAuth } from './socket-auth';

const DEFAULT_PORT = 3000;

export function createApp(): express.Express {
  const app = express();

  // A CSP would need tuning to the Angular build, and HSTS and COEP break plain-HTTP LAN
  // access. The remaining helmet defaults suit the app as is.
  app.use(helmet({ contentSecurityPolicy: false, hsts: false, crossOriginEmbedderPolicy: false }));
  app.use(express.json());

  // Static files are served before the session check: the login page itself has to load.
  const angularDistPath = path.join(__dirname, '../../dist/cerious-aasm/browser');
  app.use(express.static(angularDistPath));
  app.use('/api', sessionAuth);
  setupAuthRoutes(app);

  app.use((req: express.Request, res: express.Response) => {
    res.sendFile(path.join(angularDistPath, 'index.html'));
  });

  return app;
}

/** --port, then PORT, then 3000. Main passes both when it forks this process. */
export function getServerPort(): number {
  const arg = process.argv.find(a => a.startsWith('--port='));
  return parsePort(arg?.slice('--port='.length)) ?? parsePort(process.env.PORT) ?? DEFAULT_PORT;
}

export function startServer(app: express.Express, port: number): void {
  setupIPCHandlers();
  installSocketAuth();

  // Express 5 hands a listen failure such as EADDRINUSE to this callback.
  const server = app.listen(port, (error?: Error) => {
    if (error) {
      console.error(`[web-server] Could not listen on port ${port}:`, error.message);
      notifyMain({ type: 'server-error', port, error: error.message || 'Server startup failed' });
      return;
    }
    notifyMain({ type: 'server-ready', port, message: `Server started on port ${port}` });
  });

  server.on('error', (error: Error) => {
    console.error('[web-server] HTTP server error:', error.message);
  });

  messagingService.attachWebSocketServer(server);
}

function notifyMain(message: ChildToMainMessage): void {
  process.send?.(message);
}
