import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnChanges, SimpleChanges } from '@angular/core';
import { NgIf, NgClass, NgFor } from '@angular/common';

@Component({
  selector: 'app-server-state',
  standalone: true,
  imports: [NgIf, NgClass, NgFor],
  templateUrl: './server-state.component.html'
})
export class ServerStateComponent implements OnChanges {
  @ViewChild('logContainer') logContainer!: ElementRef;

  // Input properties
  @Input() serverInstance: any;
  @Input() logs: string[] = [];
  @Input() isVisible: boolean = true;
  
  // Track the actual logs to detect real changes vs reference changes
  private lastLogCount: number = 0;
  
  // Output events
  @Output() startServer = new EventEmitter<void>();
  @Output() stopServer = new EventEmitter<void>();
  @Output() forceStopServer = new EventEmitter<void>();
  @Output() visibilityToggled = new EventEmitter<boolean>();

  ngOnChanges(changes: SimpleChanges) {
    // Only scroll when log count actually changes (prevents infinite loop)
    if (changes['logs']) {
      const currentLogCount = this.logs.length;
      
      if (currentLogCount !== this.lastLogCount) {
        this.lastLogCount = currentLogCount;
        
        setTimeout(() => {
          if (this.logContainer && this.logContainer.nativeElement) {
            const element = this.logContainer.nativeElement;
            
            // Check if user is near bottom before auto-scrolling
            const threshold = 100;
            const scrollTop = element.scrollTop;
            const clientHeight = element.clientHeight;
            const scrollHeight = element.scrollHeight;
            const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
            const isNearBottom = distanceFromBottom <= threshold;
            
            // Only auto-scroll if user is near the bottom
            if (isNearBottom) {
              element.scrollTop = element.scrollHeight;
              element.scrollTo(0, element.scrollHeight);
              
              // Fallback: scroll last element into view
              const lastLogElement = element.lastElementChild;
              if (lastLogElement) {
                lastLogElement.scrollIntoView({ behavior: 'auto', block: 'end' });
              }
            }
          }
        }, 50);
      }
    }
  }

  // Computed properties for template
  get statusText(): string {
    return this.mapServerState(this.serverInstance?.state);
  }

  get statusClasses(): Record<string, boolean> {
    const state = this.mapServerState(this.serverInstance?.state);
    return {
      'status-running': state === 'Running',
      'status-stopped': state === 'Stopped',
      'status-starting': state === 'Starting' || state === 'Preparing to start',
      'status-stopping': state === 'Stopping',
      'status-error': state === 'Error',
      'status-unknown': !this.serverInstance?.state
    };
  }

  get currentPlayers(): number {
    return this.serverInstance?.players ?? 0;
  }

  get maxPlayers(): number {
    return this.serverInstance?.maxPlayers ?? 70;
  }

  get serverMessage(): string | null {
    return this.serverInstance?.message || null;
  }

  get memoryUsage(): string | undefined {
    const memory = this.serverInstance?.memory;
    return typeof memory === 'number' ? memory.toLocaleString() : undefined;
  }

  get canStart(): boolean {
    const state = this.mapServerState(this.serverInstance?.state);
    // Only allow start when server is truly stopped or in error state
    return state === 'Stopped' || state === 'Error' || state === 'Unknown';
  }

  get canStop(): boolean {
    const state = this.mapServerState(this.serverInstance?.state);
    // Only allow stop when server is running (not during stopping transition)
    return state === 'Running';
  }

  get canForceStop(): boolean {
    const state = this.mapServerState(this.serverInstance?.state);
    // Keep Force button available during Running, Starting, Stopping, and Queued states
    return state === 'Running' || state === 'Starting' || state === 'Stopping' || state === 'Preparing to start';
  }

  // Event handlers
  toggleVisibility(): void {
    this.isVisible = !this.isVisible;
    this.visibilityToggled.emit(this.isVisible);
  }

  onStartServer(event: Event): void {
    event.stopPropagation();
    this.startServer.emit();
  }

  onStopServer(event: Event): void {
    event.stopPropagation();
    this.stopServer.emit();
  }

  onForceStopServer(event: Event): void {
    event.stopPropagation();
    this.forceStopServer.emit();
  }

  // Utility methods
  private mapServerState(state: string | null | undefined): string {
    if (!state) return 'Unknown';
    
    const stateMap: Record<string, string> = {
      'queued': 'Preparing to start',
      'starting': 'Starting',
      'running': 'Running',
      'stopping': 'Stopping',
      'stopped': 'Stopped',
      'error': 'Error'
    };
    
    return stateMap[state.toLowerCase()] || state;
  }

  private canStartInstance(state: string | null | undefined): boolean {
    const mappedState = this.mapServerState(state);
    return mappedState === 'Stopped' || mappedState === 'Error' || mappedState === 'Unknown';
  }

  private scrollLogsToBottom(): void {
    if (this.logContainer && this.logContainer.nativeElement) {
      this.logContainer.nativeElement.scrollTop = this.logContainer.nativeElement.scrollHeight;
    }
  }

  private scrollLogsToBottomIfNeeded(): void {
    if (this.logContainer && this.logContainer.nativeElement) {
      const element = this.logContainer.nativeElement;
      const threshold = 50; // pixels from bottom
      const isNearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - threshold;
      
      // Only auto-scroll if user is already at or near the bottom
      if (isNearBottom) {
        element.scrollTop = element.scrollHeight;
      }
    }
  }
}