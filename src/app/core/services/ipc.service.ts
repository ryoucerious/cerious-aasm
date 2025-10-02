
import { Injectable } from '@angular/core';
import { Observable, from } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class IpcService {
	private ipcRenderer: any;

	constructor() {
		if ((window as any).require) {
			try {
				this.ipcRenderer = (window as any).require('electron').ipcRenderer;
			} catch (e) {
				this.ipcRenderer = null;
			}
		}
	}

	send(channel: string, ...args: any[]): void {
		if (!this.ipcRenderer) return;
		this.ipcRenderer.send(channel, ...args);
	}

	invoke(channel: string, ...args: any[]): Promise<any> {
		if (!this.ipcRenderer) return Promise.reject('Not running in Electron');
		return this.ipcRenderer.invoke(channel, ...args);
	}

	on(channel: string, listener: (...args: any[]) => void): void {
		if (!this.ipcRenderer) return;
		this.ipcRenderer.on(channel, listener);
	}

	removeListener(channel: string, listener: (...args: any[]) => void): void {
		if (!this.ipcRenderer) return;
		this.ipcRenderer.removeListener(channel, listener);
	}

	// Observable wrapper for invoke
	invoke$(channel: string, ...args: any[]): Observable<any> {
		return from(this.invoke(channel, ...args));
	}
}
