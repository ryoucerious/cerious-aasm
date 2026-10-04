import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from './auth.service';
import { CurrentIdentity } from '../models/auth.model';

interface PersonLabel {
  name: string;
  roleName: string;
}

/**
 * Names for the ownership line on a server card.
 * Admin sees every operator and assignee. An operator sees their own group.
 * A server manager, attendant, or viewer sees the operator and assignee of the servers they can open.
 */
@Injectable({ providedIn: 'root' })
export class ServerManagerDirectory {
  private readonly namesSubject = new BehaviorSubject<Record<string, string>>({});
  readonly names$ = this.namesSubject.asObservable();
  private people: Record<string, PersonLabel> = {};
  private operators: Record<string, string> = {};
  private load = 0;

  constructor(private auth: AuthService) {
    this.auth.identity$.subscribe(identity => {
      void this.sync(identity);
    });
  }

  get names(): Record<string, string> {
    return this.namesSubject.value;
  }

  operatorLabel(server: { operatorUserId?: string | null } | null | undefined): string {
    const id = server?.operatorUserId;
    if (!id) return 'Admin';
    return this.operators[id] || 'Operator';
  }

  /** Empty when nobody is assigned. The role is included when it is known. */
  assigneeLabel(server: { managerUserId?: string | null } | null | undefined): string {
    const id = server?.managerUserId;
    if (!id) return 'Not assigned';
    const person = this.people[id];
    if (person?.roleName) return `${person.roleName} · ${person.name}`;
    if (person?.name) return person.name;
    return this.names[id] || 'Assigned';
  }

  chainLabel(server: { operatorUserId?: string | null; managerUserId?: string | null } | null | undefined): string {
    return `${this.operatorLabel(server)} · ${this.assigneeLabel(server)}`;
  }

  /** Kept for older callers. The card uses assigneeLabel so the role stays visible. */
  label(server: { managerUserId?: string | null } | null | undefined): string {
    const id = server?.managerUserId;
    if (!id) return '';
    return this.people[id]?.name || 'Assigned';
  }

  private formatName(person: { username: string; displayName: string }): string {
    if (person.displayName && person.displayName !== person.username) {
      return `${person.displayName} (${person.username})`;
    }
    return person.displayName || person.username;
  }

  private async sync(identity: CurrentIdentity): Promise<void> {
    const load = ++this.load;
    const people: Record<string, PersonLabel> = {};
    const operators: Record<string, string> = {};
    const user = identity.user;
    if ((user?.roleId === 'server-manager' || user?.roleId === 'attendant') && user.id) {
      people[user.id] = { name: user.displayName || user.username, roleName: user.roleName || '' };
    }
    if (identity.isAdmin || user) {
      const labels = await this.auth.listOwnershipLabels();
      if (load !== this.load) return;
      for (const operator of labels.operators) operators[operator.id] = this.formatName(operator);
      for (const assignee of labels.assignees) {
        people[assignee.id] = { name: this.formatName(assignee), roleName: assignee.roleName || '' };
      }
    }
    if (load !== this.load) return;
    this.people = people;
    this.operators = operators;
    const names: Record<string, string> = {};
    for (const [id, person] of Object.entries(people)) names[id] = person.name;
    this.namesSubject.next(names);
  }
}
