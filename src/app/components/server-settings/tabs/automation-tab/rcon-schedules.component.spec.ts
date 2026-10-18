import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RconSchedulesComponent } from './rcon-schedules.component';
import { ServerInstance } from '../../../../core/models/server-instance.model';

describe('RCON schedule autosave', () => {
  let fixture: ComponentFixture<RconSchedulesComponent>;
  let component: RconSchedulesComponent;
  let server: Partial<ServerInstance>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RconSchedulesComponent] }).compileComponents();
    fixture = TestBed.createComponent(RconSchedulesComponent);
    component = fixture.componentInstance;
    server = { rconSchedules: [{ id: 'one', command: 'SaveWorld', enabled: false, mode: 'interval', intervalMinutes: 60, times: ['02:00'] }] };
    fixture.componentRef.setInput('server', server);
    fixture.detectChanges();
    await fixture.whenStable();
    spyOn(component.save, 'emit');
  });
  function input(selector: string): HTMLInputElement { return fixture.nativeElement.querySelector(selector); }
  it('keeps typing local and saves the command on blur without a Save button', () => {
    const command = input('#rcon-command-one');
    command.value = 'DestroyWildDinos';
    command.dispatchEvent(new Event('input'));
    expect(server.rconSchedules![0].command).toBe('SaveWorld');
    expect(component.save.emit).not.toHaveBeenCalled();
    command.dispatchEvent(new Event('blur'));
    expect(server.rconSchedules![0].command).toBe('DestroyWildDinos');
    expect(component.save.emit).toHaveBeenCalledTimes(1);
    command.dispatchEvent(new Event('blur'));
    expect(component.save.emit).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).not.toContain('Save RCON Schedules');
  });
  it('uses the custom dropdown and immediately saves its selection', () => {
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
    fixture.nativeElement.querySelector('.custom-dropdown button').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelectorAll('[role=option]')[1].click();
    fixture.detectChanges();
    expect(server.rconSchedules![0].mode).toBe('daily');
    expect(component.save.emit).toHaveBeenCalledTimes(1);
    const times = input('#rcon-times-one');
    times.value = '06:00, 18:00';
    times.dispatchEvent(new Event('blur'));
    expect(server.rconSchedules![0].times).toEqual(['06:00', '18:00']);
  });
  it('keeps incomplete drafts and invalid edits out of server configuration', () => {
    component.add();
    const draft = component.jobs[1];
    component.commit(draft);
    expect(server.rconSchedules!.length).toBe(1);
    expect(component.save.emit).not.toHaveBeenCalled();
    component.jobs[0].intervalMinutes = 0;
    component.commit(component.jobs[0]);
    expect(server.rconSchedules![0].intervalMinutes).toBe(60);
    expect(component.errors['one']).toContain('whole number');
    draft.command = 'DestroyWildDinos';
    component.commit(draft);
    expect(server.rconSchedules!.length).toBe(2);
    expect(server.rconSchedules![0].intervalMinutes).toBe(60);
    expect(component.save.emit).toHaveBeenCalledTimes(1);
  });
  it('saves toggles and removal immediately', async () => {
    input('.toggle-switch').click();
    await fixture.whenStable();
    expect(server.rconSchedules![0].enabled).toBeTrue();
    expect(component.save.emit).toHaveBeenCalledTimes(1);
    component.remove(component.jobs[0]);
    expect(server.rconSchedules).toEqual([]);
    expect(component.save.emit).toHaveBeenCalledTimes(2);
  });
});
