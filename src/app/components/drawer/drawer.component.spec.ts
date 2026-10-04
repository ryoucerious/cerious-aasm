import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DrawerComponent } from './drawer.component';
import { ModalComponent } from '../modal/modal.component';

@Component({
  standalone: true,
  imports: [DrawerComponent, ModalComponent],
  template: `
    <app-drawer [open]="drawerOpen" title="Settings" (closed)="drawerOpen = false">
      <button class="inside">Inside</button>
      <app-modal title="Edit User" [show]="modalOpen" (close)="modalOpen = false">
        <button class="in-modal">In the modal</button>
      </app-modal>
    </app-drawer>
  `
})
class DrawerHostComponent {
  drawerOpen = true;
  modalOpen = false;
}

describe('DrawerComponent', () => {
  let fixture: ComponentFixture<DrawerHostComponent>;
  let host: DrawerHostComponent;

  function pressEscape(on: Element): void {
    on.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DrawerHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(DrawerHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => document.body.classList.remove('drawer-open'));

  it('closes on Escape', () => {
    pressEscape(fixture.nativeElement.querySelector('.inside'));
    expect(host.drawerOpen).toBeFalse();
  });

  it('closes on a click on its backdrop', () => {
    fixture.nativeElement.querySelector('.drawer-backdrop').click();
    expect(host.drawerOpen).toBeFalse();
  });

  it('leaves Escape to a dialog open over it', () => {
    host.modalOpen = true;
    fixture.detectChanges();

    pressEscape(fixture.nativeElement.querySelector('.in-modal'));

    expect(host.modalOpen).toBeFalse();
    expect(host.drawerOpen).toBeTrue();
  });

  it('leaves an Escape that something inside it already handled', () => {
    const inside = fixture.nativeElement.querySelector('.inside') as HTMLElement;
    inside.addEventListener('keydown', event => event.preventDefault(), { once: true });
    pressEscape(inside);
    expect(host.drawerOpen).toBeTrue();
  });
});
