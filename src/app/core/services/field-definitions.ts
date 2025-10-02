import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, shareReplay } from 'rxjs';

export interface FieldDefinition {
  tab: string;
  label: string;
  key: string;
  type: string;
  default?: any;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: any[];
  placeholder?: string;
}

@Injectable({
  providedIn: 'root'
})
export class FieldDefinitionsService {
  private fieldDefinitions$: Observable<FieldDefinition[]> | null = null;

  constructor(private http: HttpClient) {}

  /**
   * Get all field definitions
   */
  getFieldDefinitions(): Observable<FieldDefinition[]> {
    if (!this.fieldDefinitions$) {
      this.fieldDefinitions$ = this.http.get<FieldDefinition[]>('assets/advanced-settings-meta.json').pipe(
        shareReplay(1)
      );
    }
    return this.fieldDefinitions$;
  }

  /**
   * Get field label by key
   */
  getFieldLabel(key: string): Observable<string> {
    return this.getFieldDefinitions().pipe(
      map(fields => {
        const field = fields.find(f => f.key === key);
        return field ? field.label : key; // Fallback to key if not found
      })
    );
  }

  /**
   * Get field definition by key
   */
  getFieldDefinition(key: string): Observable<FieldDefinition | undefined> {
    return this.getFieldDefinitions().pipe(
      map(fields => fields.find(f => f.key === key))
    );
  }

  /**
   * Get fields by tab
   */
  getFieldsByTab(tab: string): Observable<FieldDefinition[]> {
    return this.getFieldDefinitions().pipe(
      map(fields => fields.filter(f => f.tab === tab))
    );
  }
}
