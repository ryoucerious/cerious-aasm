import { ApplicationConfig, inject, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideToastr } from 'ngx-toastr';
import { routes } from './app.routes';

import { MESSAGE_TRANSPORT } from './core/services/messaging/message-transport.interface';
import { IpcMessageTransport } from './core/services/messaging/ipc-message-transport.service';
import { ApiMessageTransport } from './core/services/messaging/api-message-transport.service';
import { IpcService } from './core/services/ipc.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withHashLocation()),
    provideHttpClient(),
    // ngx-toastr animates its toasts with @angular/animations.
    provideAnimations(),
    provideToastr({
      positionClass: 'toast-top-right',
      preventDuplicates: true
    }),
    IpcMessageTransport,
    ApiMessageTransport,
    {
      provide: MESSAGE_TRANSPORT,
      useFactory: () => inject(IpcService).isElectron ? inject(IpcMessageTransport) : inject(ApiMessageTransport)
    }
  ]
};
