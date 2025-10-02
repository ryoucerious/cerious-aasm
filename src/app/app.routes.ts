import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { defaultRouteGuard } from './guards/default-route.guard';

export const routes: Routes = [
  { 
    path: '', 
    canActivate: [defaultRouteGuard],
    children: []
  },
  { 
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent)
  },
  { 
    path: 'server', 
    loadComponent: () => import('./pages/server/server.component').then(m => m.ServerComponent),
    canActivate: [authGuard]
  },
  { 
    path: 'settings', 
    loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsPageComponent),
    canActivate: [authGuard]
  }
];
