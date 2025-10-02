import { Injectable } from '@angular/core';
import { from, Observable } from 'rxjs';

// Electron IPC interfaces for type safety
declare global {
  interface Window {
    electronAPI?: {
      checkProtonInstalled: () => Promise<ProtonCheckResponse>;
      installProton: () => Promise<ProtonInstallResponse>;
      getProtonDir: () => Promise<ProtonDirectoryResponse>;
      getPlatformInfo: () => Promise<PlatformInfoResponse>;
    };
  }
}

export interface ProtonCheckResponse {
  success: boolean;
  installed: boolean;
  path: string | null;
  message?: string;
  error?: string;
}

export interface ProtonInstallResponse {
  success: boolean;
  message?: string;
  error?: string;
  output?: string;
}

export interface ProtonDirectoryResponse {
  success: boolean;
  path: string | null;
  error?: string;
}

export interface PlatformInfoResponse {
  success: boolean;
  platform: string;
  needsProton: boolean;
  protonInstalled: boolean;
  ready: boolean;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class ProtonService {

  /**
   * Check if Proton is installed (Linux only)
   * @returns Observable<ProtonCheckResponse>
   */
  checkProtonInstalled(): Observable<ProtonCheckResponse> {
    if (!window.electronAPI?.checkProtonInstalled) {
      return from(Promise.resolve({
        success: false,
        installed: false,
        path: null,
        error: 'Electron API not available'
      }));
    }

    return from(window.electronAPI.checkProtonInstalled());
  }

  /**
   * Install Proton (Linux only)
   * @returns Observable<ProtonInstallResponse>
   */
  installProton(): Observable<ProtonInstallResponse> {
    if (!window.electronAPI?.installProton) {
      return from(Promise.resolve({
        success: false,
        error: 'Electron API not available'
      }));
    }

    return from(window.electronAPI.installProton());
  }

  /**
   * Get Proton directory path
   * @returns Observable<ProtonDirectoryResponse>
   */
  getProtonDirectory(): Observable<ProtonDirectoryResponse> {
    if (!window.electronAPI?.getProtonDir) {
      return from(Promise.resolve({
        success: false,
        path: null,
        error: 'Electron API not available'
      }));
    }

    return from(window.electronAPI.getProtonDir());
  }

  /**
   * Get platform information and Proton readiness
   * @returns Observable<PlatformInfoResponse>
   */
  getPlatformInfo(): Observable<PlatformInfoResponse> {
    if (!window.electronAPI?.getPlatformInfo) {
      return from(Promise.resolve({
        success: false,
        platform: 'unknown',
        needsProton: false,
        protonInstalled: false,
        ready: false,
        error: 'Electron API not available'
      }));
    }

    return from(window.electronAPI.getPlatformInfo());
  }
}