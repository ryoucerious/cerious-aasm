import { Component, Input, ViewChild, ElementRef, OnChanges, SimpleChanges } from '@angular/core';
import { NgIf, NgFor } from '@angular/common';
import { ServerInstance } from '../../core/models/server-instance.model';

/** How close to the bottom, in pixels, still counts as following the output. */
const FOLLOW_THRESHOLD_PX = 100;

@Component({
  selector: 'app-server-state',
  standalone: true,
  imports: [NgIf, NgFor],
  templateUrl: './server-state.component.html'
})
export class ServerStateComponent implements OnChanges {
  @ViewChild('logContainer') logContainer?: ElementRef<HTMLElement>;

  @Input() serverInstance: Pick<ServerInstance, 'message'> | null = null;
  @Input() logs: string[] = [];

  private shownLength = 0;
  private shownLastLine: string | undefined;

  get serverMessage(): string | null {
    return this.serverInstance?.message || null;
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!changes['logs']) return;
    // The buffer holds at most 1000 lines, so once it is full only the last line tells new
    // output apart; comparing it also skips a re-render of the same output.
    const lastLine = this.logs[this.logs.length - 1];
    if (this.logs.length === this.shownLength && lastLine === this.shownLastLine) return;
    this.shownLength = this.logs.length;
    this.shownLastLine = lastLine;
    setTimeout(() => this.followOutput(), 50);
  }

  /** Scrolls to the newest line, unless the user has scrolled up to read. */
  private followOutput(): void {
    const element = this.logContainer?.nativeElement;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - (element.scrollTop + element.clientHeight);
    if (distanceFromBottom > FOLLOW_THRESHOLD_PX) return;
    element.scrollTop = element.scrollHeight;
    element.scrollTo(0, element.scrollHeight);
    element.lastElementChild?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }
}
