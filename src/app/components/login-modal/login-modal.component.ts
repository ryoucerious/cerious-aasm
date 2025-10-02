import { Component, Input, Output, EventEmitter } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-login-modal',
  standalone: true,
  imports: [NgIf, FormsModule],
  templateUrl: './login-modal.component.html'
})
export class LoginModalComponent {
  @Input() show = false;
  @Output() loginAttempt = new EventEmitter<{username: string, password: string}>();
  @Output() close = new EventEmitter<void>();

  username = '';
  password = '';
  errorMessage = '';
  isLoading = false;

  onLogin() {
    if (!this.username.trim() || !this.password.trim()) {
      this.errorMessage = 'Please enter both username and password';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    
    this.loginAttempt.emit({
      username: this.username.trim(),
      password: this.password.trim()
    });
  }

  showError(message: string) {
    this.errorMessage = message;
    this.isLoading = false;
  }

  reset() {
    this.username = '';
    this.password = '';
    this.errorMessage = '';
    this.isLoading = false;
  }
}