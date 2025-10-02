import { Component, inject } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MessagingService } from '../../core/services/messaging/messaging.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [NgIf, FormsModule],
  templateUrl: './login.component.html'
})
export class LoginComponent {
  private messagingService = inject(MessagingService);
  private router = inject(Router);

  username = '';
  password = '';
  errorMessage = '';
  isLoading = false;

  async onLogin() {
    if (!this.username.trim() || !this.password.trim()) {
      this.errorMessage = 'Please enter both username and password';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: this.username.trim(),
          password: this.password.trim()
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Login successful, redirect to main app
          this.router.navigate(['/server']);
        } else {
          this.errorMessage = data.error || 'Login failed';
          this.isLoading = false;
        }
      } else {
        const data = await response.json();
        this.errorMessage = data.error || 'Invalid credentials';
        this.isLoading = false;
      }
    } catch (error) {
      this.errorMessage = 'Connection error. Please try again.';
      this.isLoading = false;
    }
  }

  onEnterKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      this.onLogin();
    }
  }
}