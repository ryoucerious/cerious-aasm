import { ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EMPTY, Observable, Subject, Subscription, catchError, defer, finalize, switchMap, tap } from 'rxjs';
import { MessagingService } from '../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../core/services/notification.service';

interface IniFile {
  instanceId: string;
  filename: string;
}

interface IniFileReply {
  success?: boolean;
  content?: string;
  error?: string;
}

/** Expert mode: one of the server's INI files as raw text, read from and written to disk. */
@Component({
  selector: 'app-ini-editor',
  standalone: true,
  imports: [NgIf, FormsModule],
  templateUrl: './ini-editor.component.html',
  styles: [':host { display: block; }']
})
export class IniEditorComponent implements OnChanges, OnDestroy {
  @Input() instanceId: string | undefined;
  @Input() filename = '';

  content = '';
  loading = false;
  saving = false;

  private file: IniFile | null = null;
  /** The file's text as last read or written; null until it has loaded. */
  private savedContent: string | null = null;
  // Each load replaces the one in flight, so a reply for a file the user has left never lands.
  private readonly loads = new Subject<IniFile>();
  private readonly subscription: Subscription;

  constructor(
    private messaging: MessagingService,
    private notification: NotificationService,
    private cdr: ChangeDetectorRef
  ) {
    this.subscription = this.loads.pipe(switchMap(file => this.fetch(file))).subscribe();
  }

  /** Until the file has been read there is nothing safe to write back: saving would replace it with an empty editor. */
  get loaded(): boolean {
    return this.savedContent !== null;
  }

  get dirty(): boolean {
    return this.loaded && this.content !== this.savedContent;
  }

  /** Loads only when the server or the file changes; a new copy of the same server keeps the edits. */
  ngOnChanges(): void {
    if (!this.instanceId || !this.filename) return;
    if (this.file?.instanceId === this.instanceId && this.file.filename === this.filename) return;
    this.offerToSave();
    this.file = { instanceId: this.instanceId, filename: this.filename };
    this.load();
  }

  ngOnDestroy(): void {
    this.offerToSave();
    this.subscription.unsubscribe();
  }

  reload(): void {
    if (this.dirty && !confirm(`Discard your changes to ${this.filename} and load it from disk again?`)) return;
    this.load();
  }

  save(): void {
    if (this.file && this.loaded) this.write(this.file, this.content);
  }

  private offerToSave(): void {
    if (this.file && this.dirty && confirm(`${this.file.filename} has unsaved changes. Save them now? Cancel discards them.`)) {
      this.write(this.file, this.content);
    }
  }

  private load(): void {
    if (!this.file) return;
    this.content = '';
    this.savedContent = null;
    this.loads.next(this.file);
  }

  private fetch(file: IniFile): Observable<IniFileReply> {
    return defer(() => {
      this.loading = true;
      return this.messaging.sendMessage<IniFileReply>('get-ini-file', { instanceId: file.instanceId, filename: file.filename });
    }).pipe(
      tap(res => {
        if (res?.success === false) {
          this.notification.error(res.error || 'Failed to load INI file.', 'Expert Mode');
          return;
        }
        this.content = res?.content ?? '';
        this.savedContent = this.content;
      }),
      catchError(() => {
        this.notification.error('Failed to load INI file.', 'Expert Mode');
        return EMPTY;
      }),
      finalize(() => {
        this.loading = false;
        this.cdr.markForCheck();
      })
    );
  }

  private write(file: IniFile, content: string): void {
    this.saving = true;
    this.messaging.sendMessage<IniFileReply>('save-ini-file', { instanceId: file.instanceId, filename: file.filename, content })
      .subscribe({
        next: res => {
          if (res?.success) {
            this.notification.success(`Saved ${file.filename}`, 'Expert Mode');
            if (this.file === file) this.savedContent = content;
          } else {
            this.notification.error(res?.error || 'Save failed.', 'Expert Mode');
          }
          this.saving = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.notification.error('Failed to save INI file.', 'Expert Mode');
          this.saving = false;
          this.cdr.markForCheck();
        }
      });
  }
}
