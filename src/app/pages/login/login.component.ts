import { Component, inject } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { WebSocketService } from '../../core/services/web-socket.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [NgIf, FormsModule],
  templateUrl: './login.component.html'
})
export class LoginComponent {
  private messagingService = inject(MessagingService);
  private webSocket = inject(WebSocketService);
  private auth = inject(AuthService);
  private router = inject(Router);

  username = '';
  password = '';
  errorMessage = '';
  isLoading = false;

  async onLogin() {
    if (!this.username.trim() || !this.password.trim()) {
      this.errorMessage = 'Please enter your username and password.';
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
          // The socket was refused while there was no session; now there is one, so open a
          // fresh connection and wait for it before handing over to the dashboard. Without
          // the wait, every page behind the login asks for its data down a socket that is
          // not up yet and comes up empty until the next reload.
          this.webSocket.reconnectNow();
          await this.webSocket.whenConnected(4000);
          // Who we are was asked for once when the app loaded, down a socket that was
          // refused; ask again now that there is a session behind it.
          this.auth.refresh();
          this.isLoading = false;
          this.router.navigate(['/dashboard']);
        } else {
          this.errorMessage = this.messageFor(response.status, data?.error);
          this.isLoading = false;
        }
      } else {
        const data = await response.json().catch(() => null);
        this.errorMessage = this.messageFor(response.status, data?.error);
        this.isLoading = false;
      }
    } catch (error) {
      this.errorMessage = 'Unable to reach the server. Please check that it is running and try again.';
      this.isLoading = false;
    }
  }

  /**
   * What to tell someone whose sign-in did not go through.
   *
   * "Invalid credentials" is the wire's wording, not something to put in front of a person:
   * it reads like a fault report and does not say what to do next. The reply never says
   * which of the two was wrong, and it should not — that would tell an outsider which
   * usernames exist.
   */
  private messageFor(status: number, serverError?: string): string {
    if (status === 401) {
      return 'Incorrect username or password. Please try again.';
    }
    if (status === 400) {
      return serverError || 'Please enter your username and password.';
    }
    if (status === 429) {
      return 'Too many sign-in attempts. Please wait a moment and try again.';
    }
    if (status >= 500) {
      return serverError || 'The server was unable to complete your sign-in. Please try again or check the server log.';
    }
    return serverError || 'Sign-in failed. Please try again.';
  }

  onEnterKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      this.onLogin();
    }
  }
}