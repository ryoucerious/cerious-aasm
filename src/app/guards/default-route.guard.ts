import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { IpcService } from '../core/services/ipc.service';
import { AuthService } from '../core/services/auth.service';
import { hasWebAccess } from './auth-status';

/** Sends the empty route to the dashboard, or to the login page when a sign-in is required. */
export const defaultRouteGuard: CanActivateFn = async () => {
  const router = inject(Router);
  if (inject(IpcService).isElectron) {
    const auth = inject(AuthService);
    await auth.whenReady();
    router.navigate([auth.needsMeshSignIn ? '/login' : '/dashboard']);
    return false;
  }
  const allowed = await hasWebAccess();
  router.navigate([allowed ? '/dashboard' : '/login']);
  return false;
};
