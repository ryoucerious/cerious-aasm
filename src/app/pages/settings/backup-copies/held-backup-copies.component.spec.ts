import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, Subject, of } from 'rxjs';
import { HeldBackupCopiesComponent } from './held-backup-copies.component';
import { BackupCopiesService, HeldBackupCopy } from '../../../core/services/backup-copies.service';
import { NotificationService } from '../../../core/services/notification.service';
import { BusyService } from '../../../core/services/busy.service';

describe('HeldBackupCopiesComponent', () => {
  const far: HeldBackupCopy = {
    serverId: 'b1', serverName: 'Far', fileName: 'backup_manual_1.zip', size: 2048, fromNodeId: 'n1', fromNodeName: 'PC 1', copiedAt: Date.now()
  };
  let fixture: ComponentFixture<HeldBackupCopiesComponent>;
  let copies: jasmine.SpyObj<BackupCopiesService>;
  let notification: jasmine.SpyObj<NotificationService>;

  async function open(held: HeldBackupCopy[]): Promise<HTMLElement> {
    copies.held.and.returnValue(of({ copies: held }));
    fixture = TestBed.createComponent(HeldBackupCopiesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const button = (page: HTMLElement, label: string) =>
    Array.from(page.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.trim() === label) ?? null;

  beforeEach(() => {
    copies = jasmine.createSpyObj('BackupCopiesService', ['held', 'restore']);
    notification = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info', 'warning']);
    TestBed.configureTestingModule({
      imports: [HeldBackupCopiesComponent],
      providers: [
        { provide: BackupCopiesService, useValue: copies },
        { provide: NotificationService, useValue: notification }
      ]
    });
  });

  it('lists the copies this machine keeps for servers on other machines', async () => {
    const page = await open([far]);
    const row = page.querySelector('.held-copy') as HTMLElement;

    expect(row.textContent).toContain('Far');
    expect(row.textContent).toContain('PC 1');
    expect(row.textContent).toContain('backup_manual_1.zip');
  });

  it('shows nothing while it keeps none', async () => {
    const page = await open([]);

    expect(page.querySelector('.held-copies')).toBeNull();
  });

  // The machine the server ran on is lost: the server comes back here.
  it('makes a new server here from a copy, under a name of its own, with the app covered meanwhile', async () => {
    const page = await open([far]);
    const reply = new Subject<{ success: boolean }>();
    copies.restore.and.returnValue(reply);

    button(page, 'Restore here as a new server')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const name = page.querySelector<HTMLInputElement>('input[name="restore-name"]')!;
    expect(name.value).toBe('Far (restored)');
    name.value = 'Far again';
    name.dispatchEvent(new Event('input'));
    button(page, 'Restore')!.click();

    expect(copies.restore).toHaveBeenCalledWith('b1', 'Far again');
    expect(TestBed.inject(BusyService).message).toContain('Far again');
    reply.next({ success: true });
    expect(TestBed.inject(BusyService).message).toBeNull();
    expect(notification.success).toHaveBeenCalledWith('Far again was made from the copy of the latest backup of Far.', 'Backup');
  });

  it('says why it could not', async () => {
    const page = await open([far]);
    copies.restore.and.returnValue(of({ success: false, error: 'A server with this name already exists.' }));

    button(page, 'Restore here as a new server')!.click();
    fixture.detectChanges();
    button(page, 'Restore')!.click();

    expect(notification.error).toHaveBeenCalledWith('A server with this name already exists.', 'Backup');
  });

  it('waits quietly while the list is asked for', () => {
    copies.held.and.returnValue(NEVER);
    fixture = TestBed.createComponent(HeldBackupCopiesComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.held-copies')).toBeNull();
  });
});
