import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UtilityService } from '../core/services/utility.service';

export const defaultRouteGuard: CanActivateFn = async (route, state) => {
  const router = inject(Router);
  const utilityService = inject(UtilityService);
  
  // Use comprehensive platform detection
  const platform = utilityService.getPlatform();
  const isElectronApp = platform === 'Electron';
  
  // Additional fallback: file:// protocol detection (for production safety)
  const isFileProtocol = window.location.protocol === 'file:';
  const isElectronEnvironment = isElectronApp || isFileProtocol;
  
  if (isElectronEnvironment) {
    // In desktop Electron mode, go directly to the dashboard
    router.navigate(['/dashboard']);
    return false;
  }

  // In web mode, ask the server over HTTP whether a sign-in is needed and whether we have
  // one. Asking the message bus for the configuration first meant this depended on the
  // WebSocket, which is not up yet in the moment right after signing in.
  try {
    const response = await fetch('/api/auth-status', { credentials: 'include' });

    if (response.ok) {
      const data = await response.json();
      const allowed = data.requiresAuth === false || data.authenticated;
      router.navigate([allowed ? '/dashboard' : '/login']);
      return false;
    }

    router.navigate(['/login']);
    return false;
  } catch (error) {
    router.navigate(['/login']);
    return false;
  }
};