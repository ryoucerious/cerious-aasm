import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { IpcService } from '../core/services/ipc.service';
import { AuthService } from '../core/services/auth.service';
import { hasWebAccess } from './auth-status';

/** The desktop app signs in only after it joins a mesh. The web UI needs a session when asked. */
export const authGuard: CanActivateFn = async () => {
  const router = inject(Router);
  if (inject(IpcService).isElectron) {
    if (await desktopNeedsSignIn()) {
      router.navigate(['/login']);
      return false;
    }
    return true;
  }

  if (await hasWebAccess()) return true;

  router.navigate(['/login']);
  return false;
};

async function desktopNeedsSignIn(): Promise<boolean> {
  const auth = inject(AuthService);
  await auth.whenReady();
  return auth.needsMeshSignIn;
}
