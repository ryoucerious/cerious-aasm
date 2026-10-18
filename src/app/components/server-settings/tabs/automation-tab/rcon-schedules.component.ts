import { Component, Input, Output, EventEmitter, OnChanges, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ServerInstance, RconSchedule } from '../../../../core/models/server-instance.model';

@Component({
  selector: 'app-rcon-schedules', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './rcon-schedules.component.html',
  styles: [`
    :host { display: block; grid-column: 1 / -1; min-width: 0; }
    .rcon-schedule { grid-column: 1 / -1; min-width: 0; border-top: 1px solid var(--border); padding-top: 1rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 1rem; }
    .schedule-header { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .75rem; }
    .schedule-header h6 { margin: 0; font-size: 1rem; }
    .form-group { min-width: 0; }
    .schedule-error { grid-column: 1 / -1; color: var(--danger, #ef4444); margin: 0; }
  `]
})
export class RconSchedulesComponent implements OnChanges {
  @Input() server: Partial<ServerInstance> = {};
  @Output() save = new EventEmitter<void>();
  jobs: RconSchedule[] = [];
  errors: Record<string, string> = {};
  openDropdown: string | null = null;
  readonly modes = [{ value: 'interval' as const, label: 'Repeat interval' }, { value: 'daily' as const, label: 'Daily times' }];

  ngOnChanges(): void {
    this.jobs = (this.server.rconSchedules || []).map(job => this.copy(job));
    this.errors = {};
    this.openDropdown = null;
  }
  private copy(job: RconSchedule): RconSchedule { return { ...job, ...(job.times ? { times: [...job.times] } : {}) }; }
  trackById(_index: number, job: RconSchedule): string { return job.id; }
  add(): void {
    this.jobs = [...this.jobs, {
      id: `rcon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, enabled: false, command: '', mode: 'interval', intervalMinutes: 60, times: ['02:00']
    }];
  }
  remove(job: RconSchedule): void {
    this.jobs = this.jobs.filter(item => item.id !== job.id);
    delete this.errors[job.id];
    if (this.openDropdown === job.id) this.openDropdown = null;
    const saved = this.server.rconSchedules || [];
    if (!saved.some(item => item.id === job.id)) return;
    this.server.rconSchedules = saved.filter(item => item.id !== job.id);
    this.save.emit();
  }
  setTimes(job: RconSchedule, text: string): void {
    job.times = text.split(',').map(time => time.trim()).filter(Boolean);
    this.commit(job);
  }
  selectMode(job: RconSchedule, mode: RconSchedule['mode']): void {
    job.mode = mode;
    if (mode === 'daily' && !job.times?.length) job.times = ['02:00'];
    if (mode === 'interval' && job.intervalMinutes == null) job.intervalMinutes = 60;
    this.openDropdown = null;
    this.commit(job);
  }
  @HostListener('document:click') closeDropdown(): void { this.openDropdown = null; }
  commit(job: RconSchedule): void {
    let error = '';
    if (!job.command.trim() || job.command.length > 2000 || /[\r\n\0]/.test(job.command)) error = 'Enter a command on a single line before this schedule can be saved.';
    else if (job.mode === 'interval' && (!Number.isInteger(job.intervalMinutes) || job.intervalMinutes! < 1 || job.intervalMinutes! > 10080)) error = 'Enter a whole number of minutes from 1 to 10080.';
    else if (job.mode === 'daily' && (!job.times?.length || job.times.length > 48 || job.times.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))) error = 'Enter up to 48 times in HH:MM format, separated by commas.';
    if (error) { this.errors[job.id] = error; return; }
    delete this.errors[job.id];
    const saved = this.server.rconSchedules || [];
    const previous = saved.find(item => item.id === job.id);
    if (JSON.stringify(previous) === JSON.stringify(job)) return;
    this.server.rconSchedules = previous ? saved.map(item => item.id === job.id ? this.copy(job) : item) : [...saved, this.copy(job)];
    this.save.emit();
  }
}
