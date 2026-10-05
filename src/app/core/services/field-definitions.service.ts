import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';

export type FieldOption = string | { value: string; display: string };

/** One entry of assets/advanced-settings-meta.json. */
export interface FieldDefinition {
  tab: string;
  label: string;
  key: string;
  type: string;
  default?: unknown;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: FieldOption[];
  placeholder?: string;
}

@Injectable({ providedIn: 'root' })
export class FieldDefinitionsService {
  private readonly definitions$: Observable<FieldDefinition[]>;

  constructor(http: HttpClient) {
    // Fetched on first subscription and shared from then on; a failed fetch is retried by the next subscriber.
    this.definitions$ = http.get<FieldDefinition[]>('assets/advanced-settings-meta.json').pipe(shareReplay(1));
  }

  getFieldDefinitions(): Observable<FieldDefinition[]> {
    return this.definitions$;
  }
}
