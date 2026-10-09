import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

const GROUP_BY_OPERATOR_KEY = 'aasm.sidebar.groupByOperator';

/**
 * How the sidebar lists the servers, set in Settings → Servers. Kept in this browser only: each
 * person who uses the app chooses for themselves.
 */
@Injectable({ providedIn: 'root' })
export class ServerListPreferencesService {
  private readonly groupByOperatorSubject = new BehaviorSubject<boolean>(read(GROUP_BY_OPERATOR_KEY));

  /** Each operator's servers together, above the machines of a mesh. */
  get groupByOperator$(): Observable<boolean> {
    return this.groupByOperatorSubject.asObservable();
  }

  get groupByOperator(): boolean {
    return this.groupByOperatorSubject.value;
  }

  setGroupByOperator(on: boolean): void {
    try {
      localStorage.setItem(GROUP_BY_OPERATOR_KEY, on ? '1' : '0');
    } catch {
      /* the choice lasts until the page closes */
    }
    this.groupByOperatorSubject.next(on);
  }
}

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
