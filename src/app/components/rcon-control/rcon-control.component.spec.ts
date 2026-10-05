import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RconControlComponent } from './rcon-control.component';

describe('RconControlComponent', () => {
  let component: RconControlComponent;
  let fixture: ComponentFixture<RconControlComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RconControlComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(RconControlComponent);
    component = fixture.componentInstance;
    component.rconConnected = true;
    component.serverState = 'running';
    component.knownCommands = ['say', 'kick'];
    component.lastResponse = 'OK';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit sendMessage on onSendMessage', () => {
    spyOn(component.sendMessage, 'emit');
    component.rconMessage = 'hello';
    component.onSendMessage();
    expect(component.sendMessage.emit).toHaveBeenCalledWith('hello');
    expect(component.rconMessage).toBe('');
  });

  it('should not emit sendMessage if rconMessage is empty', () => {
    spyOn(component.sendMessage, 'emit');
    component.rconMessage = '   ';
    component.onSendMessage();
    expect(component.sendMessage.emit).not.toHaveBeenCalled();
  });

  it('shows the known commands while the input has focus', () => {
    component.onInputFocus();
    expect(component.inputFocused).toBeTrue();
  });

  it('hides the known commands shortly after the input loses focus', () => {
    component.inputFocused = true;
    jasmine.clock().install();
    try {
      component.onInputBlur();
      expect(component.inputFocused).toBeTrue();
      jasmine.clock().tick(151);
      expect(component.inputFocused).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('should fill the input with a known command', () => {
    component.inputFocused = true;
    component.fillCommand('say');
    expect(component.rconMessage).toBe('say');
    expect(component.inputFocused).toBeFalse();
  });
});
