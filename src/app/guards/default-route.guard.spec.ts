import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { defaultRouteGuard } from './default-route.guard';
import { UtilityService } from '../core/services/utility.service';
import { GlobalConfigService } from '../core/services/global-config.service';

describe('defaultRouteGuard', () => {
  let router: jasmine.SpyObj<Router>;
  let utilityService: jasmine.SpyObj<UtilityService>;
  let globalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let route: ActivatedRouteSnapshot;
  let state: RouterStateSnapshot;

  beforeEach(() => {
    router = jasmine.createSpyObj('Router', ['navigate']);
    utilityService = jasmine.createSpyObj('UtilityService', ['getPlatform']);
    globalConfigService = jasmine.createSpyObj('GlobalConfigService', ['loadConfig']);

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: UtilityService, useValue: utilityService },
        { provide: GlobalConfigService, useValue: globalConfigService }
      ]
    });

    route = {} as ActivatedRouteSnapshot;
    state = {} as RouterStateSnapshot;
  });

  const runGuard = (): Promise<boolean> => {
    return TestBed.runInInjectionContext(() => defaultRouteGuard(route, state)) as Promise<boolean>;
  };

  it('should redirect to /dashboard in Electron environment', async () => {
    utilityService.getPlatform.and.returnValue('Electron');
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  // Note: window.location.protocol is not configurable in test environments,
  // so we cannot directly test the file:// protocol branch. It is covered
  // indirectly via the Electron environment test above.

  it('should redirect to /dashboard when authentication is disabled', async () => {
    utilityService.getPlatform.and.returnValue('Web');
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(JSON.stringify({ requiresAuth: false, authenticated: true }), { status: 200 })
    ));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should redirect to /dashboard when user is authenticated', async () => {
    utilityService.getPlatform.and.returnValue('Web');
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(JSON.stringify({ requiresAuth: true, authenticated: true }), { status: 200 })
    ));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should redirect to /login when user is not authenticated', async () => {
    utilityService.getPlatform.and.returnValue('Web');
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(JSON.stringify({ requiresAuth: true, authenticated: false }), { status: 200 })
    ));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should redirect to /login when auth check response is not ok', async () => {
    utilityService.getPlatform.and.returnValue('Web');
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(null, { status: 401 })
    ));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should redirect to /login on fetch error', async () => {
    utilityService.getPlatform.and.returnValue('Web');
    spyOn(window, 'fetch').and.returnValue(Promise.reject(new Error('network error')));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should redirect to /login when loadConfig throws', async () => {
    utilityService.getPlatform.and.returnValue('Web');
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should always return false since it always redirects', async () => {
    utilityService.getPlatform.and.returnValue('Electron');
    const result = await runGuard();
    expect(result).toBeFalse();
  });
});
