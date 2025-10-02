import { importProvidersFrom } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ToastrModule, provideToastr } from 'ngx-toastr';

import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, Provider } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { routes } from './app.routes';

import { MessageTransport } from './core/services/messaging/message-transport.interface';
import { IpcMessageTransport } from './core/services/messaging/ipc-message-transport.service';
import { ApiMessageTransport } from './core/services/messaging/api-message-transport.service';
import { UtilityService } from './core/services/utility.service';

function messageTransportFactory(ipc: IpcMessageTransport, api: ApiMessageTransport, util: UtilityService): MessageTransport {
  // Use UtilityService to determine platform
  const platform = util.getPlatform();
  const transport = platform === 'Electron' ? ipc : api;
  return transport;
}

const MESSAGE_TRANSPORT_PROVIDER: Provider = {
  provide: 'MessageTransport',
  useFactory: messageTransportFactory,
  deps: [IpcMessageTransport, ApiMessageTransport, UtilityService]
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withHashLocation()),
    provideHttpClient(withInterceptorsFromDi()),
    IpcMessageTransport,
    ApiMessageTransport,
    UtilityService,
    MESSAGE_TRANSPORT_PROVIDER,
    importProvidersFrom(
      BrowserAnimationsModule,
      ToastrModule.forRoot({
        positionClass: 'toast-top-right',
        preventDuplicates: true
      })
    ),
    provideToastr({
      positionClass: 'toast-top-right',
    }),
  ]
};
