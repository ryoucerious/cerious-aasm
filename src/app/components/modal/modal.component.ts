import { Component, Input, Output, EventEmitter } from '@angular/core';
import { NgIf } from '@angular/common';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [NgIf],
  templateUrl: './modal.component.html'
})
export class ModalComponent {
  @Input() title: string = '';
  @Input() show = false;
  @Input() maxWidth: string = '';
  @Output() close = new EventEmitter<void>();
}
