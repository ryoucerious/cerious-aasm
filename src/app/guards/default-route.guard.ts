import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UtilityService } from '../core/services/utility.service';
import { GlobalConfigService } from '../core/services/global-config.service';

export const defaultRouteGuard: CanActivateFn = async (route, state) => {
  const router = inject(Router);
  const utilityService = inject(UtilityService);
  const globalConfigService = inject(GlobalConfigService);
  
  // Use comprehensive platform detection
  const platform = utilityService.getPlatform();
  const isElectronApp = platform === 'Electron';
  
  // Additional fallback: file:// protocol detection (for production safety)
  const isFileProtocol = window.location.protocol === 'file:';
  const isElectronEnvironment = isElectronApp || isFileProtocol;
  
  if (isElectronEnvironment) {
    // In desktop Electron mode, go directly to server page
    router.navigate(['/server']);
    return false;
  }

  // In web mode, check authentication configuration and status
  try {
    const config = await globalConfigService.loadConfig();
    
    if (!config.authenticationEnabled) {
      // Authentication is disabled, go directly to server page
      router.navigate(['/server']);
      return false;
    }

    // Authentication is enabled, check auth status
    const response = await fetch('/api/auth-status', {
      credentials: 'include'
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.authenticated) {
        // User is authenticated, go to server page
        router.navigate(['/server']);
      } else {
        // User is not authenticated, go to login page
        router.navigate(['/login']);
      }
    } else {
      // User is not authenticated, go to login page
      router.navigate(['/login']);
    }
  } catch (error) {
    // Connection error, go to login page
    router.navigate(['/login']);
  }
  
  return false; // Always return false since we're redirecting
};