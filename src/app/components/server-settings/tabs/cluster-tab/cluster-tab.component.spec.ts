import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClusterTabComponent } from './cluster-tab.component';

describe('ClusterTabComponent', () => {
  let component: ClusterTabComponent;
  let fixture: ComponentFixture<ClusterTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClusterTabComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(ClusterTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit validateField on onValidateField', () => {
    spyOn(component.validateField, 'emit');
    component.onValidateField('clusterSetting', 'value');
    expect(component.validateField.emit).toHaveBeenCalledWith({key: 'clusterSetting', value: 'value'});
  });

  it('asks the host to test the cluster directory', () => {
    spyOn(component.testConnectivity, 'emit');
    component.testClusterConnectivity();
    expect(component.testConnectivity.emit).toHaveBeenCalled();
  });

  describe('the directory test', () => {
    const testButton = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find(button => button.textContent?.includes('Test Cluster Directory Connection'));

    beforeEach(() => {
      fixture.componentRef.setInput('serverInstance', { clusterDirOverride: 'D:/ark-cluster' });
    });

    it('is offered in the desktop app', () => {
      fixture.componentRef.setInput('isElectron', true);
      fixture.detectChanges();
      expect(testButton()).toBeTruthy();
    });

    it('is not offered in the web UI, where the backend refuses it', () => {
      fixture.componentRef.setInput('isElectron', false);
      fixture.detectChanges();
      expect(testButton()).toBeUndefined();
    });
  });

  it('shows validation messages for its fields', () => {
    component.fieldErrors = { clusterId: 'Cluster ID contains invalid characters' };
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.validation-error')?.textContent)
      .toContain('Cluster ID contains invalid characters');
  });
});
