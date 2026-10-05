import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { defaultRouteGuard } from './default-route.guard';
import { IpcService } from '../core/services/ipc.service';

describe('defaultRouteGuard', () => {
  let router: jasmine.SpyObj<Router>;
  let ipc: { isElectron: boolean };
  let route: ActivatedRouteSnapshot;
  let state: RouterStateSnapshot;

  beforeEach(() => {
    router = jasmine.createSpyObj('Router', ['navigate']);
    ipc = { isElectron: false };

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: IpcService, useValue: ipc }
      ]
    });

    route = {} as ActivatedRouteSnapshot;
    state = {} as RouterStateSnapshot;
  });

  const runGuard = (): Promise<boolean> => {
    return TestBed.runInInjectionContext(() => defaultRouteGuard(route, state)) as Promise<boolean>;
  };

  it('should redirect to /dashboard in Electron environment', async () => {
    ipc.isElectron = true;
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should redirect to /dashboard when authentication is disabled', async () => {
    ipc.isElectron = false;
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(JSON.stringify({ requiresAuth: false, authenticated: true }), { status: 200 })
    ));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should redirect to /dashboard when user is authenticated', async () => {
    ipc.isElectron = false;
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(JSON.stringify({ requiresAuth: true, authenticated: true }), { status: 200 })
    ));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
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

  it('should always return false since it always redirects', async () => {
    ipc.isElectron = true;
    const result = await runGuard();
    expect(result).toBeFalse();
  });
});
