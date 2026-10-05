import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { IpcService } from './ipc.service';

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

  constructor(private ipc: IpcService) {
    if (!this.ipc.isElectron) return;

    // The main process tells us when the window is maximised, including when the user
    // double-clicks the drag region or uses a keyboard shortcut.
    this.ipc.on('window-maximized-changed', (_event, maximized) => this.maximizedSubject.next(!!maximized));

    this.ipc.invoke('window-is-maximized')
      .then(maximized => this.maximizedSubject.next(!!maximized))
      .catch(() => { /* window not ready yet; the event above will correct it */ });
  }

  /** True only in the desktop app, where there is a window to control. */
  get isAvailable(): boolean {
    return this.ipc.isElectron;
  }

  get isMaximized(): boolean {
    return this.maximizedSubject.value;
  }

  get isMaximized$(): Observable<boolean> {
    return this.maximizedSubject.asObservable();
  }

  minimize(): void {
    this.ipc.send('window-minimize');
  }

  toggleMaximize(): void {
    this.ipc.send('window-maximize-toggle');
  }

  /** Runs the same shutdown confirmation as the native close button did. */
  close(): void {
    this.ipc.send('window-close');
  }
}
