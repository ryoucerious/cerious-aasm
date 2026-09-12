import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { UtilityService } from './utility.service';

/**
 * Minimise / maximise / close for the frameless desktop window.
 *
 * The app draws its own title bar (see WindowControlsComponent), so these replace the native
 * buttons. Closing goes through the window's own close event, which keeps the existing
 * "servers are still running" confirmation. In the web UI none of this applies and
 * {@link isAvailable} is false.
 */
@Injectable({ providedIn: 'root' })
export class WindowService {
  private readonly maximizedSubject = new BehaviorSubject<boolean>(false);
  private ipcRenderer: any = null;

  constructor(private utility: UtilityService, private zone: NgZone) {
    if (this.utility.getPlatform() !== 'Electron') return;
    try {
      this.ipcRenderer = (window as any).require?.('electron')?.ipcRenderer ?? null;
    } catch {
      this.ipcRenderer = null;
    }
    if (!this.ipcRenderer) return;

    // The main process tells us when the window is maximised, including when the user
    // double-clicks the drag region or uses a keyboard shortcut. Both calls are guarded:
    // an ipcRenderer without them is not worth failing app startup over.
    if (typeof this.ipcRenderer.on === 'function') {
      this.ipcRenderer.on('window-maximized-changed', (_event: any, maximized: boolean) => {
        this.zone.run(() => this.maximizedSubject.next(!!maximized));
      });
    }

    if (typeof this.ipcRenderer.invoke === 'function') {
      Promise.resolve(this.ipcRenderer.invoke('window-is-maximized'))
        .then((maximized: boolean) => this.zone.run(() => this.maximizedSubject.next(!!maximized)))
        .catch(() => { /* window not ready yet; the event above will correct it */ });
    }
  }

  /** True only in the desktop app, where there is a window to control. */
  get isAvailable(): boolean {
    return !!this.ipcRenderer;
  }

  get isMaximized(): boolean {
    return this.maximizedSubject.value;
  }

  get isMaximized$(): Observable<boolean> {
    return this.maximizedSubject.asObservable();
  }

  minimize(): void {
    this.ipcRenderer?.send('window-minimize');
  }

  toggleMaximize(): void {
    this.ipcRenderer?.send('window-maximize-toggle');
  }

  /** Runs the same shutdown confirmation as the native close button did. */
  close(): void {
    this.ipcRenderer?.send('window-close');
  }
}
