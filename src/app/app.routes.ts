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
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [authGuard]
  },
  {
    // Bare /server lands on the console; the sidebar links to the specific pages.
    path: 'server',
    redirectTo: 'server/console',
    pathMatch: 'full'
  },
  {
    path: 'server/:tab',
    loadComponent: () => import('./pages/server/server.component').then(m => m.ServerComponent),
    canActivate: [authGuard]
  },
  {
    // Settings moved into a drawer; old links land on the dashboard, which hosts it.
    path: 'settings',
    redirectTo: 'dashboard'
  },
  {
    path: 'settings/:tab',
    redirectTo: 'dashboard'
  },
  {
    path: '**',
    redirectTo: ''
  }
];
