import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BackupCopiesService, HeldBackupCopy } from '../../../core/services/backup-copies.service';
import { NotificationService } from '../../../core/services/notification.service';
import { BusyService } from '../../../core/services/busy.service';
import { ModalComponent } from '../../../components/modal/modal.component';
import { formatBytes, formatLocalDateTime } from '../../../core/utils/format.utils';

/**
 * Settings → Storage: the copies this machine keeps of the latest backups of servers on other
 * machines of the mesh. When the machine a server ran on is lost, the server comes back here.
 */
@Component({
  selector: 'app-held-backup-copies',
  standalone: true,
  imports: [NgIf, NgFor, FormsModule, ModalComponent],
  templateUrl: './held-backup-copies.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeldBackupCopiesComponent implements OnInit {
  copies: HeldBackupCopy[] = [];
  /** The copy the Restore dialog is open for. */
  restoring: HeldBackupCopy | null = null;
  restoreName = '';
  readonly formatSize = formatBytes;

  constructor(
    private backupCopies: BackupCopiesService,
    private notification: NotificationService,
    private busy: BusyService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.load();
  }

  copiedAt(copy: HeldBackupCopy): string {
    return formatLocalDateTime(new Date(copy.copiedAt));
  }

  askRestore(copy: HeldBackupCopy): void {
    this.restoring = copy;
    this.restoreName = `${copy.serverName} (restored)`;
    this.cdr.markForCheck();
  }

  confirmRestore(): void {
    const copy = this.restoring;
    const name = this.restoreName.trim();
    if (!copy || !name) return;
    this.restoring = null;
    const done = this.busy.start(`Making ${name} from the copy of the latest backup of ${copy.serverName}…`);
    this.backupCopies.restore(copy.serverId, name).subscribe({
      next: reply => {
        done();
        if (reply?.success) this.notification.success(`${name} was made from the copy of the latest backup of ${copy.serverName}.`, 'Backup');
        else this.notification.error(reply?.error || `Could not make ${name} from the copy.`, 'Backup');
        this.cdr.markForCheck();
      },
      error: () => {
        done();
        this.notification.error(`Could not make ${name} from the copy.`, 'Backup');
        this.cdr.markForCheck();
      }
    });
    this.cdr.markForCheck();
  }

  private load(): void {
    this.backupCopies.held().subscribe({
      next: reply => {
        this.copies = reply?.copies || [];
        this.cdr.markForCheck();
      },
      error: () => { /* none to show */ }
    });
  }
}
