import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TOAST_CONFIG } from 'ngx-toastr';
import { appConfig } from './app.config';

describe('appConfig', () => {
  it('suppresses duplicate toasts', () => {
    const injector = createEnvironmentInjector(appConfig.providers, TestBed.inject(EnvironmentInjector));
    try {
      const toastConfig = injector.get(TOAST_CONFIG);
      expect(toastConfig.config.preventDuplicates).toBeTrue();
      expect(toastConfig.config.positionClass).toBe('toast-top-right');
    } finally {
      injector.destroy();
    }
  });
});
