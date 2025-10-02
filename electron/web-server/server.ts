import { initializeAuth } from './auth-config';
import { createApp, getServerPort, startServer } from './server-setup';

// =============================================================================
// SERVER STARTUP
// =============================================================================

// Initialize authentication and start server
export async function startWebServer(): Promise<void> {
  try {
    // Initialize authentication system
    await initializeAuth();

    // Create and configure Express app
    const app = createApp();
    const port = getServerPort();

    // Start the server
    startServer(app, port);

  } catch (error) {
    console.error('[Web Server] Failed to start:', error);
    process.exit(1);
  }
}

// Only start the server if this file is being run directly (not required as a module)
if (require.main === module) {
  startWebServer();
}

// =============================================================================
// EXPORTS
// =============================================================================

// Export authentication functions for external use
export { updateAuthConfig, hashPassword } from './auth-config';
