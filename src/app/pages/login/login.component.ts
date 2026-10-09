import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { IpcService } from '../../core/services/ipc.service';
import { MessagingService } from '../../core/services/messaging/messaging.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [NgIf, FormsModule],
  templateUrl: './login.component.html'
})
export class LoginComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private ipc = inject(IpcService);
  private messaging = inject(MessagingService);
  private cdr = inject(ChangeDetectorRef);

  username = '';
  password = '';
  errorMessage = '';
  isLoading = false;
  /** A mesh with no accounts yet: this form creates the admin instead of checking a password. */
  creatingAdmin = false;
  /** The account this machine's own admin password signs in as, since it joined the mesh. */
  ownLogin = '';
  readonly isElectron: boolean;

  constructor() {
    this.isElectron = this.ipc.isElectron;
  }

  ngOnInit(): void {
    if (!this.isElectron) return;
    this.messaging.sendMessage<{ enabled?: boolean; hasAccounts?: boolean; ownLogin?: string }>('get-mesh-status', {}).subscribe(status => {
      this.creatingAdmin = !!status?.enabled && status.hasAccounts === false;
      this.ownLogin = status?.ownLogin || '';
      if (this.ownLogin && !this.username) this.username = this.ownLogin;
      this.cdr.markForCheck();
    });
  }

  get heading(): string {
    if (!this.isElectron) return 'Web Interface Login';
    return this.creatingAdmin ? 'Create the mesh admin' : 'Sign in';
  }

  get hint(): string {
    if (!this.isElectron) return '';
    if (this.creatingAdmin) return 'This mesh has no accounts yet. The password needs at least 8 characters.';
    const own = this.ownLogin ? ` This machine's own admin password signs in as ${this.ownLogin}.` : '';
    return `This machine is in a mesh. Sign in with your account.${own}`;
  }

  // The password goes exactly as typed: spaces are characters like any other.
  async onLogin() {
    if (!this.username.trim() || !this.password) {
      this.errorMessage = 'Please enter your username and password.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const result = this.creatingAdmin
      ? await this.auth.bootstrapMeshAdmin(this.username.trim(), this.password)
      : await this.auth.login(this.username.trim(), this.password);
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
      return serverError && serverError !== 'Invalid credentials'
        ? serverError
        : 'Incorrect username or password. Please try again.';
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
