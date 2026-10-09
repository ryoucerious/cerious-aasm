import { Injectable, OnDestroy } from '@angular/core';
import { Observable, ReplaySubject, Subscription, firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { GlobalConfig } from '../interfaces/global-config.interface';
import { MessagingService } from './messaging/messaging.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';

/** get-global-config answers with the settings themselves, or with an error. */
type LoadReply = (GlobalConfig & { requestId?: string }) | { error: string; requestId?: string };

interface SaveReply {
  success?: boolean;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class GlobalConfigService implements OnDestroy {
  /** Null until the settings are first known; the setters change nothing before then. */
  private config: GlobalConfig | null = null;
  private readonly received = new ReplaySubject<GlobalConfig>(1);
  private readonly subs: Subscription[] = [];

  constructor(private messaging: MessagingService, webSocket: WebSocketService, ipc: IpcService) {
    // The backend sends every client the settings whenever anyone reads or saves them.
    this.subs.push(this.messaging.receiveMessage<GlobalConfig>('global-config').subscribe(cfg => {
      if (cfg) this.receive(cfg);
    }));

    // The web UI asks whenever its socket comes up: a request made before that, or after the
    // session was refused, is dropped and only times out. The desktop app has no socket and
    // asks once.
    this.subs.push(webSocket.connected$.pipe(filter(connected => connected)).subscribe(() => this.refresh()));
    if (ipc.isElectron) this.refresh();
    this.subs.push(this.messaging.receiveMessage('mesh-auth-changed').subscribe(() => this.refresh()));
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub.unsubscribe());
  }

  /** The settings once they are known, then again whenever the backend reports them. A late listener gets the latest. */
  get config$(): Observable<GlobalConfig> {
    return this.received.asObservable();
  }

  /** Rejects if the request fails, times out, or the backend could not read the settings. */
  async loadConfig(): Promise<GlobalConfig> {
    const reply = await firstValueFrom(this.messaging.sendMessage<LoadReply | null>('get-global-config', {}));
    if (!reply || 'error' in reply) throw new Error(reply?.error || 'Could not load the settings');
    const { requestId: _requestId, ...config } = reply;
    this.receive(config);
    return config;
  }

  async saveConfig(cfg: GlobalConfig): Promise<void> {
    const reply = await firstValueFrom(this.messaging.sendMessage<SaveReply | null>('set-global-config', { config: cfg }));
    if (!reply?.success) throw new Error(reply?.error || 'Failed to save config');
    this.config = cfg;
  }

  get startWebServerOnLoad() {
    return this.config?.startWebServerOnLoad ?? false;
  }
  set startWebServerOnLoad(val: boolean) {
    if (!this.config) return;
    this.config.startWebServerOnLoad = val;
    this.persist();
  }

  get webServerPort() {
    return this.config?.webServerPort ?? 3000;
  }
  set webServerPort(val: number) {
    if (!this.config) return;
    this.config.webServerPort = val;
    this.persist();
  }

  get authenticationEnabled() {
    return this.config?.authenticationEnabled ?? false;
  }
  set authenticationEnabled(val: boolean) {
    if (!this.config) return;
    this.config.authenticationEnabled = val;
    this.persist();
  }

  get maxBackupDownloadSizeMB() {
    return this.config?.maxBackupDownloadSizeMB ?? 100;
  }
  set maxBackupDownloadSizeMB(val: number) {
    if (!this.config) return;
    this.config.maxBackupDownloadSizeMB = val;
    this.persist();
  }

  get serverDataDir() {
    return this.config?.serverDataDir ?? '';
  }
  set serverDataDir(val: string) {
    if (!this.config) return;
    this.config.serverDataDir = val;
    this.persist();
  }

  get autoUpdateArkServer() {
    return this.config?.autoUpdateArkServer ?? false;
  }
  set autoUpdateArkServer(val: boolean) {
    if (!this.config) return;
    this.config.autoUpdateArkServer = val;
    this.persist();
  }

  get updateWarningMinutes() {
    return this.config?.updateWarningMinutes ?? 15;
  }
  set updateWarningMinutes(val: number) {
    if (!this.config) return;
    this.config.updateWarningMinutes = val;
    this.persist();
  }

  get serverStartDelaySeconds() {
    return this.config?.serverStartDelaySeconds ?? 60;
  }
  set serverStartDelaySeconds(val: number) {
    if (!this.config) return;
    this.config.serverStartDelaySeconds = val;
    this.persist();
  }

  private receive(config: GlobalConfig): void {
    this.config = config;
    this.received.next(config);
  }

  private refresh(): void {
    this.loadConfig().catch(error => console.error('[global-config] Could not load the settings:', error));
  }

  private persist(): void {
    if (!this.config) return;
    this.saveConfig(this.config).catch(error => console.error('[global-config] Could not save the settings:', error));
  }
}
