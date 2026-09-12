import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UtilityService } from '../core/services/utility.service';

export const authGuard: CanActivateFn = async (route, state) => {
  const router = inject(Router);
  const utilityService = inject(UtilityService);
  
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
    // One question, over HTTP: does this server want a sign-in, and are we signed in?
    //
    // It used to ask the message bus for the configuration first, which travels over the
    // WebSocket — and the socket is still reconnecting in the moment right after signing
    // in, so the question failed and sent the user straight back to the login page.
    const response = await fetch('/api/auth-status', { credentials: 'include' });

    if (response.ok) {
      const data = await response.json();
      // Only an explicit "no sign-in needed" lets someone through without a session; a
      // reply missing the field is treated as needing one.
      if (data.requiresAuth === false || data.authenticated) {
        return true;
      }
    }

    router.navigate(['/login']);
    return false;
  } catch (error) {
    // The server could not be reached at all.
    router.navigate(['/login']);
    return false;
  }
};