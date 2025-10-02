import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-rcon-control',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rcon-control.component.html'
})
export class RconControlComponent {
  @Input() rconConnected = false;
  @Input() serverState = '';
  @Input() knownCommands: string[] = [];
  @Input() lastResponse = '';
  
  @Output() sendMessage = new EventEmitter<string>();
  @Output() inputFocus = new EventEmitter<void>();
  @Output() inputBlur = new EventEmitter<void>();
  @Output() commandFill = new EventEmitter<string>();

  showRcon = true;
  rconMessage = '';
  inputFocused = false;

  onSendMessage() {
    if (!this.rconMessage?.trim()) return;
    this.sendMessage.emit(this.rconMessage);
    this.rconMessage = '';
  }

  onInputFocus() {
    this.inputFocused = true;
    this.inputFocus.emit();
  }

  onInputBlur() {
    setTimeout(() => this.inputFocused = false, 150);
    this.inputBlur.emit();
  }

  fillCommand(cmd: string) {
    this.rconMessage = cmd;
    this.inputFocused = false;
    this.commandFill.emit(cmd);
  }
}