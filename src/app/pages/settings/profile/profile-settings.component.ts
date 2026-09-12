import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { NgIf, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UtilityService } from '../../../core/services/utility.service';
import { CurrentIdentity } from '../../../core/models/auth.model';

/**
 * The signed-in account: who you are, what you may do, and your own password.
 *
 * The desktop app has no account — whoever is at the machine owns it — so this explains that
 * rather than offering a password form that would have nothing to change.
 */
@Component({
  selector: 'app-profile-settings',
  standalone: true,
  imports: [NgIf, DatePipe, FormsModule],
  templateUrl: './profile-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProfileSettingsComponent implements OnInit, OnDestroy {
  identity: CurrentIdentity | null = null;
  saving = false;
  form = { current: '', next: '', confirm: '' };
  private sub?: Subscription;

  constructor(
    private auth: AuthService,
    private notification: NotificationService,
    private utility: UtilityService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.auth.identity$.subscribe(identity => {
      this.identity = identity;
      this.cdr.markForCheck();
    });
    this.auth.refresh();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  get hasAccount(): boolean {
    return !!this.identity?.user;
  }

  /**
   * The desktop app owns the machine and never signs in. Read from the platform rather than
   * the identity: with authentication off, a web client is granted the same rights as the
   * desktop and so reports itself as the local owner, which is true of its permissions but
   * not of where it is running.
   */
  get isDesktop(): boolean {
    return this.utility.getPlatform() !== 'Web';
  }

  /** Shown in place of the account name when no account backs this session. */
  get fallbackName(): string {
    return this.isDesktop ? 'Local administrator' : 'Web console';
  }

  get roleName(): string {
    return this.identity?.user?.roleName || (this.identity?.isAdmin ? 'Administrator' : 'Unknown');
  }

  get displayName(): string {
    return this.identity?.user?.displayName || this.identity?.user?.username || this.fallbackName;
  }

  get permissionCount(): number {
    return this.identity?.permissions?.length ?? 0;
  }

  get passwordsMatch(): boolean {
    return !this.form.confirm || this.form.next === this.form.confirm;
  }

  get canSave(): boolean {
    return !this.saving
      && !!this.form.current
      && this.form.next.length >= 8
      && this.form.next === this.form.confirm;
  }

  async changePassword(): Promise<void> {
    if (!this.canSave) return;
    this.saving = true;
    this.cdr.markForCheck();

    const result = await this.auth.changeOwnPassword(this.form.current, this.form.next);
    this.saving = false;

    if (result.success) {
      this.notification.success('Your password has been changed', 'Account');
      this.form = { current: '', next: '', confirm: '' };
    } else {
      this.notification.error(result.error || 'Could not change your password', 'Account');
    }
    this.cdr.markForCheck();
  }
}
