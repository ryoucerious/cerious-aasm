import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { IpcService } from '../core/services/ipc.service';
import { hasWebAccess } from './auth-status';

/** The desktop app never signs in; the web UI needs a session when the server asks for one. */
export const authGuard: CanActivateFn = async () => {
  const router = inject(Router);
  if (inject(IpcService).isElectron) return true;

  if (await hasWebAccess()) return true;

  router.navigate(['/login']);
  return false;
};
