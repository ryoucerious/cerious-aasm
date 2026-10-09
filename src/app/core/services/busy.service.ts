import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, distinctUntilChanged, map } from 'rxjs';

/**
 * Something the app has to wait for before anything else may be used, such as a machine leaving
 * the mesh. The app's overlay shows it over everything, with a spinner, and the app behind it
 * cannot be clicked or typed into until it is done.
 */
@Injectable({ providedIn: 'root' })
export class BusyService {
  /** What is under way, oldest first. Each entry is its own object, so two alike are told apart. */
  private readonly underWay = new BehaviorSubject<readonly { message: string }[]>([]);

  /** What the overlay shows: the latest thing still under way, or null when there is nothing. */
  readonly message$: Observable<string | null> = this.underWay.pipe(
    map(entries => entries.length ? entries[entries.length - 1].message : null),
    distinctUntilChanged()
  );

  get message(): string | null {
    const entries = this.underWay.value;
    return entries.length ? entries[entries.length - 1].message : null;
  }

  /** Shows `message` until the returned function is called; calling it again does nothing. */
  start(message: string): () => void {
    const entry = { message };
    this.underWay.next([...this.underWay.value, entry]);
    return () => {
      if (!this.underWay.value.includes(entry)) return;
      this.underWay.next(this.underWay.value.filter(other => other !== entry));
    };
  }
}
