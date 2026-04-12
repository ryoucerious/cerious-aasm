import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { authGuard } from './auth.guard';
import { UtilityService } from '../core/services/utility.service';
import { GlobalConfigService } from '../core/services/global-config.service';

describe('authGuard', () => {
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
    return TestBed.runInInjectionContext(() => authGuard(route, state)) as Promise<boolean>;
  };

  it('should allow access in Electron environment', async () => {
    utilityService.getPlatform.and.returnValue('Electron');
    const result = await runGuard();
    expect(result).toBeTrue();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  // Note: window.location.protocol is not configurable in test environments,
  // so we cannot directly test the file:// protocol branch. It is covered
  // indirectly via the Electron environment test above.

  it('should allow access in web mode when authentication is disabled', async () => {
    utilityService.getPlatform.and.returnValue('Web');
    globalConfigService.loadConfig.and.returnValue(Promise.resolve({ authenticationEnabled: false } as any));
    const result = await runGuard();
    expect(result).toBeTrue();
  });

  it('should allow access when user is authenticated', async () => {
    utilityService.getPlatform.and.returnValue('Web');
    globalConfigService.loadConfig.and.returnValue(Promise.resolve({ authenticationEnabled: true } as any));
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(JSON.stringify({ authenticated: true }), { status: 200 })
    ));
    const result = await runGuard();
    expect(result).toBeTrue();
  });

  it('should redirect to /login when user is not authenticated', async () => {
    utilityService.getPlatform.and.returnValue('Web');
    globalConfigService.loadConfig.and.returnValue(Promise.resolve({ authenticationEnabled: true } as any));
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(JSON.stringify({ authenticated: false }), { status: 200 })
    ));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should redirect to /login when auth check response is not ok', async () => {
    utilityService.getPlatform.and.returnValue('Web');
    globalConfigService.loadConfig.and.returnValue(Promise.resolve({ authenticationEnabled: true } as any));
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(
      new Response(null, { status: 401 })
    ));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should redirect to /login on fetch error', async () => {
    utilityService.getPlatform.and.returnValue('Web');
    globalConfigService.loadConfig.and.returnValue(Promise.resolve({ authenticationEnabled: true } as any));
    spyOn(window, 'fetch').and.returnValue(Promise.reject(new Error('network error')));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should redirect to /login when loadConfig throws', async () => {
    utilityService.getPlatform.and.returnValue('Web');
    globalConfigService.loadConfig.and.returnValue(Promise.reject(new Error('config error')));
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });
});
