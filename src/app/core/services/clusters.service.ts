import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { MessagingService } from './messaging/messaging.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';

/** A cluster a server can join, from Settings → Clusters. */
export interface ClusterOption {
  clusterId: string;
  name: string;
  /** What ARK is given as -ClusterId. Fixed once created. */
  arkClusterId: string;
  /** In a mesh: the app keeps its transfer files on every machine. */
  managed?: boolean;
  /** In a mesh: players are told, privately in chat, once their upload has reached every machine. */
  notifyUploads?: boolean;
}

export interface ClusterReply {
  success?: boolean;
  error?: string;
  cluster?: ClusterOption;
}

/**
 * The clusters servers can join. In a mesh the mesh holds them; on a machine on its own, that
 * machine. Kept current from clusters-changed, which follows changes made here or on another
 * machine of the mesh, and asked again when this machine joins or leaves a mesh.
 */
@Injectable({ providedIn: 'root' })
export class ClustersService implements OnDestroy {
  private readonly subject = new BehaviorSubject<ClusterOption[]>([]);
  private inMesh: boolean | null = null;
  private readonly subs: Subscription[] = [];

  constructor(private messaging: MessagingService, webSocket: WebSocketService, ipc: IpcService) {
    this.subs.push(this.messaging.receiveMessage('clusters-changed').subscribe(() => this.refresh()));
    this.subs.push(this.messaging.receiveMessage<{ enabled?: boolean }>('mesh-status').subscribe(status => {
      if (typeof status?.enabled !== 'boolean') return;
      const changed = this.inMesh !== null && this.inMesh !== status.enabled;
      this.inMesh = status.enabled;
      if (changed) this.refresh();
    }));
    // The web UI asks once its socket is up: a request before that is dropped. The desktop app
    // has no socket and asks now; both ask again after a sign-in.
    this.subs.push(webSocket.connected$.pipe(filter(connected => connected)).subscribe(() => this.refresh()));
    if (ipc.isElectron) this.refresh();
    this.subs.push(this.messaging.receiveMessage('mesh-auth-changed').subscribe(() => this.refresh()));
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub.unsubscribe());
  }

  get clusters$(): Observable<ClusterOption[]> {
    return this.subject.asObservable();
  }

  get clusters(): ClusterOption[] {
    return this.subject.value;
  }

  /** The cluster's name; empty for none, or one that was removed. */
  nameOf(clusterId: string | null | undefined): string {
    return (clusterId && this.clusters.find(cluster => cluster.clusterId === clusterId)?.name) || '';
  }

  refresh(): void {
    this.messaging.sendMessage<{ success?: boolean; clusters?: ClusterOption[] }>('get-clusters', {}).subscribe({
      next: reply => {
        if (reply?.success && Array.isArray(reply.clusters)) this.subject.next(reply.clusters);
      },
      error: () => { /* the list stays as it was */ }
    });
  }

  create(name: string, arkClusterId: string): Observable<ClusterReply> {
    return this.messaging.sendMessage<ClusterReply>('create-cluster', { name, arkClusterId });
  }

  rename(clusterId: string, name: string): Observable<ClusterReply> {
    return this.messaging.sendMessage<ClusterReply>('rename-cluster', { clusterId, name });
  }

  remove(clusterId: string): Observable<ClusterReply> {
    return this.messaging.sendMessage<ClusterReply>('delete-cluster', { clusterId });
  }

  setUploadNotices(clusterId: string, enabled: boolean): Observable<ClusterReply> {
    return this.messaging.sendMessage<ClusterReply>('set-cluster-upload-notices', { clusterId, enabled });
  }
}
