import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-firewall-tab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './firewall-tab.component.html',
  styleUrls: ['./firewall-tab.component.scss']
})
export class FirewallTabComponent {
  @Input() serverInstance: any = {};
}