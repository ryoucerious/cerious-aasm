import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UtilityService } from '../core/services/utility.service';
import { GlobalConfigService } from '../core/services/global-config.service';

export const authGuard: CanActivateFn = async (route, state) => {
  const router = inject(Router);
  const utilityService = inject(UtilityService);
  const globalConfigService = inject(GlobalConfigService);
  
  // Use comprehensive platform detection
  const platform = utilityService.getPlatform();
  const isElectronApp = platform === 'Electron';
  
  // Additional fallback: file:// protocol detection (for production safety)
  const isFileProtocol = window.location.protocol === 'file:';
  const isElectronEnvironment = isElectronApp || isFileProtocol;
  
  // Only apply auth guard in web mode, not in Electron desktop app
  if (isElectronEnvironment) {
    return true; // Always allow access in Electron desktop mode
  }

  try {
    // First check if authentication is enabled in the configuration
    const config = await globalConfigService.loadConfig();
    if (!config.authenticationEnabled) {
      return true; // Authentication is disabled, allow access
    }

    // Check if user is authenticated (only for web/browser access when auth is enabled)
    const response = await fetch('/api/auth-status', {
      credentials: 'include'
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.authenticated) {
        return true; // User is authenticated
      }
    }
    
    // User is not authenticated, redirect to login
    router.navigate(['/login']);
    return false;
  } catch (error) {
    // Connection error, redirect to login
    router.navigate(['/login']);
    return false;
  }
};