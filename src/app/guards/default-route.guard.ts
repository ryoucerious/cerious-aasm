import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { IpcService } from '../core/services/ipc.service';
import { hasWebAccess } from './auth-status';

/** Sends the empty route to the dashboard, or to the login page when the web UI needs a sign-in. */
export const defaultRouteGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const allowed = inject(IpcService).isElectron || await hasWebAccess();
  router.navigate([allowed ? '/dashboard' : '/login']);
  return false;
};
