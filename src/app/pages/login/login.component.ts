import { Component, inject } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [NgIf, FormsModule],
  templateUrl: './login.component.html'
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  username = '';
  password = '';
  errorMessage = '';
  isLoading = false;

  // The password goes exactly as typed: spaces are characters like any other.
  async onLogin() {
    if (!this.username.trim() || !this.password) {
      this.errorMessage = 'Please enter your username and password.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const result = await this.auth.login(this.username.trim(), this.password);
    this.isLoading = false;

    if (result.success) {
      this.router.navigate(['/dashboard']);
    } else {
      this.errorMessage = this.messageFor(result.status, result.error);
    }
  }

  /**
   * What to tell someone whose sign-in did not go through.
   *
   * "Invalid credentials" is the wire's wording, not something to put in front of a person:
   * it reads like a fault report and does not say what to do next. The reply never says
   * which of the two was wrong, and it should not: that would tell an outsider which
   * usernames exist.
   */
  private messageFor(status: number, serverError?: string): string {
    if (status === 0) {
      return 'Unable to reach the server. Please check that it is running and try again.';
    }
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
