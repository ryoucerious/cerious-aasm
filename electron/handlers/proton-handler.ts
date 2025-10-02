import { ipcMain } from 'electron';
import { ProtonService } from '../services/proton.service';

// Initialize service
const protonService = new ProtonService();

/** Handles the 'check-proton-installed' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the ProtonService to check if Proton is installed.
 * It then returns the result, including details such as success status, installation status,
 * the installation path if applicable, and any error information.
 * In case of unexpected errors during the check, it logs the error and returns a failure
 * response.
 * 
 * @returns An object containing the result of the check.
 */
ipcMain.handle('check-proton-installed', async () => {
  try {
    return await protonService.checkProtonInstalled();
  } catch (error) {
    console.error('[proton-handler] Unexpected error:', error);
    return { 
      success: false, 
      installed: false, 
      error: error instanceof Error ? error.message : 'Unexpected error',
      path: null
    };
  }
});

/** Handles the 'install-proton' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the ProtonService to install Proton.
 * It then returns the result, including details such as success status and any error information.
 * In case of unexpected errors during the installation, it logs the error and returns a failure
 * response.
 *
 * @returns An object containing the result of the installation attempt.
 */
ipcMain.handle('install-proton', async () => {
  try {
    return await protonService.installProton();
  } catch (error) {
    console.error('[proton-handler] Unexpected error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unexpected error' 
    };
  }
});

/** Handles the 'get-proton-dir' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the ProtonService to get the installation directory of Proton.
 * It then returns the result, including details such as success status, the path if applicable,
 * and any error information.
 * In case of unexpected errors during the retrieval, it logs the error and returns a failure
 * response.
 * 
 * @returns An object containing the Proton installation directory information.
 */
ipcMain.handle('get-proton-dir', async () => {
  try {
    return await protonService.getProtonDirectory();
  } catch (error) {
    console.error('[proton-handler] Unexpected error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unexpected error',
      path: null
    };
  }
});

/** Handles the 'get-platform-info' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the ProtonService to get platform information.
 * It then returns the result, including details such as success status, platform name,
 * and any error information.
 * In case of unexpected errors during the retrieval, it logs the error and returns a failure
 * response.
 * 
 * @returns An object containing the platform information.
 */
ipcMain.handle('get-platform-info', async () => {
  try {
    return await protonService.getPlatformInfo();
  } catch (error) {
    console.error('[proton-handler] Unexpected error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unexpected error',
      platform: 'unknown',
      needsProton: false,
      protonInstalled: false,
      ready: false
    };
  }
});
