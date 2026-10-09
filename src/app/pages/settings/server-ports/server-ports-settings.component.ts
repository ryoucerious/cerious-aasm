import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  FirewallService,
  PortOutsideRange,
  ServerPortRanges,
  ServerPortsReply,
  ServerPortsState
} from '../../../core/services/firewall.service';
import { NotificationService } from '../../../core/services/notification.service';
import { IpcService } from '../../../core/services/ipc.service';
import { BusyService } from '../../../core/services/busy.service';

type RangeKey = keyof ServerPortRanges;

/** Ranges as typed: the boxes hold whatever was entered until Save. */
type RangeForm = Record<RangeKey, { start: number | null; end: number | null }>;

const ROWS: Array<{ key: RangeKey; label: string; protocol: string }> = [
  { key: 'game', label: 'Game and peer ports', protocol: 'UDP' },
  { key: 'query', label: 'Query ports', protocol: 'UDP' },
  { key: 'rcon', label: 'RCON ports', protocol: 'TCP' }
];

/**
 * Settings → Server Defaults → Server Ports: the ranges this machine's servers take their ports from, and its
 * firewall for them. Windows Firewall opens them with one admin prompt; Linux gets the commands;
 * in Docker they come from docker-compose.yml. Every new server then fits inside them, so neither
 * firewall has to be touched again, and on Windows nobody has to answer a prompt per server.
 */
@Component({
  selector: 'app-server-ports-settings',
  standalone: true,
  imports: [NgIf, NgFor, FormsModule],
  templateUrl: './server-ports-settings.component.html',
  styleUrls: ['./server-ports-settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServerPortsSettingsComponent implements OnInit, OnDestroy {
  readonly rows = ROWS;
  state: ServerPortsState | null = null;
  form: RangeForm = { game: { start: null, end: null }, query: { start: null, end: null }, rcon: { start: null, end: null } };
  saving = false;
  readonly isDesktop: boolean;
  private subs = new Subscription();

  constructor(
    private firewall: FirewallService,
    private notification: NotificationService,
    private busy: BusyService,
    private cdr: ChangeDetectorRef,
    ipc: IpcService
  ) {
    this.isDesktop = ipc.isElectron;
  }

  ngOnInit(): void {
    this.subs.add(this.firewall.getServerPorts().subscribe({
      next: state => this.show(state),
      error: () => this.notification.error('Could not read the server ports.')
    }));
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  get docker(): boolean {
    return this.state?.source === 'docker';
  }

  get changed(): boolean {
    const ranges = this.state?.ranges;
    return !!ranges && ROWS.some(({ key }) => this.form[key].start !== ranges[key].start || this.form[key].end !== ranges[key].end);
  }

  /** Windows Firewall keeps players out of some of the ports, or a server here. */
  get needsOpening(): boolean {
    const status = this.state?.windowsFirewall;
    return !!status && status.enabled && !status.portsOpen;
  }

  get firewallText(): string {
    if (this.state?.windowsFirewallError) return this.state.windowsFirewallError;
    const status = this.state?.windowsFirewall;
    if (!status) return '';
    if (!status.enabled) return 'Windows Firewall is off, so it does not block these ports.';
    if (status.rules === 'missing') return 'Not open in Windows Firewall yet. Players can\'t reach servers here until they are, and Windows asks about each new server.';
    if (status.rules === 'other') return 'Windows Firewall opens other ports than these. Open these instead.';
    return 'Open in Windows Firewall. Windows won\'t ask about new servers here.';
  }

  get blockedText(): string {
    const count = this.state?.windowsFirewall?.blockedPrograms.length || 0;
    if (!count) return '';
    return `Windows blocks ${count} ${count === 1 ? 'server' : 'servers'} here: someone answered Cancel when it asked about ${count === 1 ? 'it' : 'them'}. Opening the ports clears that.`;
  }

  describePorts(ports: PortOutsideRange[]): string {
    return ports.map(port => `${port.label === 'RCON' ? 'RCON' : port.label.toLowerCase()} ${port.port}`).join(', ');
  }

  save(): void {
    const ranges = {} as ServerPortRanges;
    for (const { key } of ROWS) ranges[key] = { start: Number(this.form[key].start), end: Number(this.form[key].end) };
    this.saving = true;
    this.cdr.markForCheck();
    this.firewall.setServerPorts(ranges).subscribe({
      next: reply => {
        this.saving = false;
        this.answered(reply, 'Server ports saved.', 'Could not save the server ports.');
      },
      error: () => {
        this.saving = false;
        this.notification.error('Could not save the server ports.');
        this.cdr.markForCheck();
      }
    });
  }

  /** One admin prompt, on this machine's screen; the app waits under the busy overlay meanwhile. */
  openFirewall(): void {
    const done = this.busy.start('Waiting for Windows to open the server ports… Answer Windows\' permission prompt on this machine.');
    this.firewall.openServerPortsFirewall().subscribe({
      next: reply => {
        done();
        this.answered(reply, 'The server ports are open. Windows won\'t ask about new servers here.', 'Could not open the server ports.');
      },
      error: () => {
        done();
        this.notification.error('Could not open the server ports.');
      }
    });
  }

  private answered(reply: ServerPortsReply, success: string, failure: string): void {
    if (reply?.state) this.show(reply.state);
    if (reply?.success) this.notification.success(success);
    else this.notification.error(reply?.error || failure);
    this.cdr.markForCheck();
  }

  private show(state: ServerPortsState): void {
    this.state = state;
    for (const { key } of ROWS) this.form[key] = { start: state.ranges[key].start, end: state.ranges[key].end };
    this.cdr.markForCheck();
  }
}
