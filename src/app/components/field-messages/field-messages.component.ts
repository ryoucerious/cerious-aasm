import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { NgIf } from '@angular/common';

/** Validation messages keyed by field; a field with no problem has no entry. */
export type FieldMessages = Record<string, string>;

/** The error and warning under one settings field. */
@Component({
  selector: 'app-field-messages',
  standalone: true,
  imports: [NgIf],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div *ngIf="errors[key]" class="validation-error">{{ errors[key] }}</div>
    <div *ngIf="warnings[key]" class="validation-warning">{{ warnings[key] }}</div>
  `
})
export class FieldMessagesComponent {
  @Input({ required: true }) key!: string;
  @Input() errors: FieldMessages = {};
  @Input() warnings: FieldMessages = {};
}
