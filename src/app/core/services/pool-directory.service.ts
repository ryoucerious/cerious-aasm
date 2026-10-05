import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { MessagingService } from './messaging/messaging.service';
import { CurrentIdentity, PoolLabel } from '../models/auth.model';

/**
 * Names for the ownership labels on a server card and the ownership dropdowns.
 *
 * The backend answers with what the current account may know: an admin gets every operator
 * and assignee, an operator their own pool, a pool member the people behind the servers they
 * can see. Reloaded whenever the identity, the accounts or the server list change.
 */
@Injectable({ providedIn: 'root' })
export class PoolDirectoryService {
  private readonly changed = new BehaviorSubject<void>(undefined);
  /** Emits after each reload, so OnPush views can re-render their labels. */
  readonly changed$: Observable<void> = this.changed.asObservable();

  operators: PoolLabel[] = [];
  assignees: PoolLabel[] = [];
  private loads = 0;

  constructor(private auth: AuthService, messaging: MessagingService) {
    this.auth.identity$.subscribe(() => void this.reload());
    messaging.receiveMessage('users-changed').subscribe(() => void this.reload());
    messaging.receiveMessage('server-instances').subscribe(() => void this.reload());
  }

  /** "Admin" for the admin pool, otherwise the operator's name. */
  operatorLabel(server: { operatorUserId?: string | null } | null | undefined): string {
    const id = server?.operatorUserId;
    if (!id) return 'Admin';
    const operator = this.operators.find(person => person.id === id);
    return operator ? formatName(operator) : 'Operator';
  }

  /** "Not assigned", or the assignee's role and name. */
  assigneeLabel(server: { managerUserId?: string | null } | null | undefined): string {
    const id = server?.managerUserId;
    if (!id) return 'Not assigned';
    // An id nobody answers to (deleted, disabled or demoted) is, for all purposes, nobody.
    const assignee = this.assignees.find(person => person.id === id);
    if (!assignee) return 'Not assigned';
    return assignee.roleName ? `${assignee.roleName} · ${formatName(assignee)}` : formatName(assignee);
  }

  async reload(): Promise<void> {
    const load = ++this.loads;
    const identity: CurrentIdentity = this.auth.identity;
    let next = { operators: [] as PoolLabel[], assignees: [] as PoolLabel[] };
    // A web client that is not signed in may not ask; the desktop and any account may.
    if (identity.isAdmin || identity.user) {
      next = await this.auth.listPoolLabels();
    }
    // An older answer arriving after a newer request must not win.
    if (load !== this.loads) return;
    this.operators = next.operators;
    this.assignees = next.assignees;
    this.changed.next();
  }
}

function formatName(person: PoolLabel): string {
  if (person.displayName && person.displayName !== person.username) {
    return `${person.displayName} (${person.username})`;
  }
  return person.username;
}
