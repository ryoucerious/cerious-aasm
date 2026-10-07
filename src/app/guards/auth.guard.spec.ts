import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { authGuard } from './auth.guard';
import { IpcService } from '../core/services/ipc.service';
import { AuthService } from '../core/services/auth.service';

describe('authGuard', () => {
  let router: jasmine.SpyObj<Router>;
  let ipc: { isElectron: boolean };
  /** The desktop asks for a mesh account once this machine is in a mesh. */
  let auth: { whenReady: () => Promise<void>; needsMeshSignIn: boolean };
  let route: ActivatedRouteSnapshot;
  let state: RouterStateSnapshot;

  beforeEach(() => {
    router = jasmine.createSpyObj('Router', ['navigate']);
    ipc = { isElectron: false };
    auth = { whenReady: async () => undefined, needsMeshSignIn: false };

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: IpcService, useValue: ipc },
        { provide: AuthService, useValue: auth }
      ]
    });

    route = {} as ActivatedRouteSnapshot;
    state = {} as RouterStateSnapshot;
  });

  const runGuard = (): Promise<boolean> => {
    return TestBed.runInInjectionContext(() => authGuard(route, state)) as Promise<boolean>;
  };

  it('should allow access in Electron environment', async () => {
    ipc.isElectron = true;
    const result = await runGuard();
    expect(result).toBeTrue();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('sends the desktop to sign in once this machine is in a mesh', async () => {
    ipc.isElectron = true;
    auth.needsMeshSignIn = true;

    expect(await runGuard()).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should allow access in web mode when the server wants no sign-in', async () => {
    ipc.isElectron = false;
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(JSON.stringify({ requiresAuth: false, authenticated: true }), { status: 200 })
    ));
    const result = await runGuard();
    expect(result).toBeTrue();
  });

  it('should allow access when user is authenticated', async () => {
    ipc.isElectron = false;
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(JSON.stringify({ requiresAuth: true, authenticated: true }), { status: 200 })
    ));
    const result = await runGuard();
    expect(result).toBeTrue();
  });

  it('should redirect to /login when user is not authenticated', async () => {
    ipc.isElectron = false;
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(JSON.stringify({ requiresAuth: true, authenticated: false }), { status: 200 })
    ));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should redirect to /login when auth check response is not ok', async () => {
    ipc.isElectron = false;
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(null, { status: 401 })
    ));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should redirect to /login on fetch error', async () => {
    ipc.isElectron = false;
    spyOn(window, 'fetch').and.returnValue(Promise.reject(new Error('network error')));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('treats a reply with no requiresAuth as needing a sign-in', async () => {
    ipc.isElectron = false;
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(JSON.stringify({ authenticated: false }), { status: 200 })
    ));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });
});
