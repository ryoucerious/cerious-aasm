import { Component } from '@angular/core';

@Component({
  selector: 'app-connection-lost',
  standalone: true,
  templateUrl: './connection-lost.component.html'
})
export class ConnectionLostComponent {
  reloadFn: () => void = () => window.location.reload();

  reload() {
    this.reloadFn();
  }
}
