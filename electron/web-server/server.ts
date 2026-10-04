import { initializeAuth } from './auth-config';
import { createApp, getServerPort, startServer } from './server-setup';

/** Entry point of the web server child that main forks. */
export async function startWebServer(): Promise<void> {
  // Without main nothing would stop this process, and it would keep holding the port.
  process.on('disconnect', () => process.exit(0));

  try {
    await initializeAuth();
    startServer(createApp(), getServerPort());
  } catch (error) {
    console.error('[web-server] Failed to start:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startWebServer();
}
