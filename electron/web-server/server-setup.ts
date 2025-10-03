import express from 'express';
import cors from 'cors';
import path from 'path';
import { messagingService } from '../services/messaging.service';
import { sessionAuth } from './auth-middleware';
import { setupAuthRoutes } from './auth-routes';
import { setupIPCHandlers } from './ipc-handlers';

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_PORT = 3000;

// =============================================================================
// EXPRESS SERVER SETUP
// =============================================================================

/**
 * Create and configure the Express application
 */
export function createApp(): express.Express {
  const app = express();

  // Configure middleware
  app.use(cors());
  app.use(express.json());

  // Serve Angular static files BEFORE authentication middleware
  const angularDistPath = path.join(__dirname, '../../dist/cerious-aasm/browser');
  app.use(express.static(angularDistPath));

  // Apply session-based authentication middleware ONLY to API routes
  app.use('/api', sessionAuth);

  // Setup authentication routes
  setupAuthRoutes(app);

  // Generic message endpoint
  app.post('/api/message', async (req: express.Request, res: express.Response) => {
    const { channel, payload } = req.body;

    // Basic validation - just ensure channel is a string
    if (!channel || typeof channel !== 'string') {
      res.status(400).json({ error: 'Channel is required and must be a string' });
      return;
    }

    try {
      // Forward messages to the Electron main process via IPC
      // Let the actual handlers validate the specific payload content
      if (process.send) {
        process.send({ type: 'messaging-event', channel, payload });
      } else {
        console.error('[API Server] No process.send available - not a child process?');
        res.status(500).json({ error: 'Internal server error - IPC not available' });
        return;
      }
      res.json({ status: `${channel}-sent`, channel, payload, transport: 'api' });
    } catch (error) {
      console.error('[API Server] Message processing error:', error);
      res.status(500).json({ error: 'Internal server error', channel });
    }
  });

  // Example API route
  app.get('/api/hello', (req: express.Request, res: express.Response) => {
    res.json({ message: 'Hello from Electron Express API!' });
  });

  // Fallback: serve Angular index.html for all non-API routes (Express 5.x compatible)
  app.use((req: express.Request, res: express.Response) => {
    res.sendFile(path.join(angularDistPath, 'index.html'));
  });

  return app;
}

/**
 * Exported for test coverage: parses --port=xxxx from process.argv
 */
export function getPortFromArgs(): number | undefined {
  const arg = process.argv.find(a => a.startsWith('--port='));
  if (arg) {
    const val = parseInt(arg.split('=')[1], 10);
    if (!isNaN(val)) return val;
  }
  return undefined;
}

/**
 * Get the port to use for the server
 */
export function getServerPort(): number {
  const arg = process.argv.find(a => a.startsWith('--port='));
  if (arg) {
    const val = parseInt(arg.split('=')[1], 10);
    if (!isNaN(val)) return val;
  }
  return process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;
}

/**
 * Start the HTTP server and attach WebSocket server
 */
export function startServer(app: express.Express, port: number): void {
  const serverId = Math.random().toString(36).substring(2, 8);
  const isHeadless = process.argv.includes('--headless');

  const server = app.listen(port, () => {
    const message = `Server started successfully on port ${port} (instance: ${serverId})`;
    
    // Log to console in headless mode
    if (isHeadless) {
      console.log('\n' + '='.repeat(60));
      console.log('🚀 Cerious AASM Headless Mode Started');
      console.log('='.repeat(60));
      console.log(`📡 Web server listening on port: ${port}`);
      console.log(`🔗 Access the web interface at: http://localhost:${port}`);
      
      // Check if authentication is enabled
      const authEnabled = process.argv.includes('--auth-enabled');
      if (authEnabled) {
        const username = process.argv.find(arg => arg.startsWith('--username='))?.split('=')[1] || 'admin';
        console.log(`🔐 Authentication: ENABLED (username: ${username})`);
      } else {
        console.log(`🔓 Authentication: DISABLED`);
      }
      
      console.log('='.repeat(60) + '\n');
    }
    
    // Notify main process that server is ready
    if (process.send) {
      process.send({
        type: 'server-ready',
        port,
        message
      });
    }
  });

  server.on('error', (error: any) => {
    console.error('[API Server] HTTP server error:', error);

    // Notify main process of server error
    if (process.send) {
      process.send({
        type: 'server-error',
        port,
        error: error.message || 'Server startup failed'
      });
    }
  });

  // Setup IPC handlers
  setupIPCHandlers();

  // Attach WebSocket server
  messagingService.attachWebSocketServer(server);
}