import { Injectable } from '@angular/core';
import { Observable, take } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';
import { ServerInstance } from '../models/server-instance.model';

/**
 * Service for managing server automation features including:
 * - Auto-start on app launch and system boot
 * - Crash detection and automatic recovery
 * - Scheduled server restarts
 */
@Injectable({
  providedIn: 'root'
})
export class AutomationService {

  constructor(private messaging: MessagingService) {}

  /**
   * Configure auto-start settings for a server instance
   */
  configureAutoStart(serverId: string, settings: {
    autoStartOnAppLaunch: boolean;
    autoStartOnBoot: boolean;
  }): Observable<any> {
    return this.messaging.sendMessage('configure-autostart', {
      serverId,
      ...settings
    }).pipe(take(1));
  }

  /**
   * Configure crash detection settings for a server instance
   */
  configureCrashDetection(serverId: string, settings: {
    enabled: boolean;
    checkInterval: number;
    maxRestartAttempts: number;
  }): Observable<any> {
    return this.messaging.sendMessage('configure-crash-detection', {
      serverId,
      ...settings
    }).pipe(take(1));
  }

  /**
   * Configure scheduled restart settings for a server instance
   */
  configureScheduledRestart(serverId: string, settings: {
    enabled: boolean;
    frequency: 'daily' | 'weekly' | 'custom';
    time: string;
    days: number[];
    warningMinutes: number;
  }): Observable<any> {
    return this.messaging.sendMessage('configure-scheduled-restart', {
      serverId,
      ...settings
    }).pipe(take(1));
  }

  /**
   * Get current automation status for a server instance
   */
  getAutomationStatus(serverId: string): Observable<any> {
    return this.messaging.sendMessage('get-automation-status', { serverId }).pipe(take(1));
  }

  /**
   * Start crash detection monitoring for a server instance
   */
  startCrashDetection(serverId: string): Observable<any> {
    return this.messaging.sendMessage('start-crash-detection', { serverId }).pipe(take(1));
  }

  /**
   * Stop crash detection monitoring for a server instance
   */
  stopCrashDetection(serverId: string): Observable<any> {
    return this.messaging.sendMessage('stop-crash-detection', { serverId }).pipe(take(1));
  }

  /**
   * Enable/disable scheduled restart for a server instance
   */
  toggleScheduledRestart(serverId: string, enabled: boolean): Observable<any> {
    return this.messaging.sendMessage('toggle-scheduled-restart', { serverId, enabled }).pipe(take(1));
  }

  /**
   * Manually trigger a scheduled restart for a server instance
   */
  triggerScheduledRestart(serverId: string, warningMinutes: number = 5): Observable<any> {
    return this.messaging.sendMessage('trigger-scheduled-restart', { 
      serverId, 
      warningMinutes 
    }).pipe(take(1));
  }

  /**
   * Get automation logs for debugging
   */
  getAutomationLogs(serverId: string, limit: number = 100): Observable<any> {
    return this.messaging.sendMessage('get-automation-logs', { serverId, limit }).pipe(take(1));
  }

  /**
   * Auto-start all servers that have autoStartOnAppLaunch enabled
   */
  autoStartOnAppLaunch(): Observable<any> {
    return this.messaging.sendMessage('auto-start-on-app-launch', {}).pipe(take(1));
  }

  /**
   * Validate automation settings before saving
   */
  validateAutomationSettings(serverInstance: ServerInstance): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Validate crash detection interval
    if (serverInstance.crashDetectionEnabled && serverInstance.crashDetectionInterval) {
      if (serverInstance.crashDetectionInterval < 30 || serverInstance.crashDetectionInterval > 300) {
        errors.push('Crash detection interval must be between 30 and 300 seconds');
      }
    }

    // Validate max restart attempts
    if (serverInstance.crashDetectionEnabled && serverInstance.maxRestartAttempts) {
      if (serverInstance.maxRestartAttempts < 1 || serverInstance.maxRestartAttempts > 10) {
        errors.push('Max restart attempts must be between 1 and 10');
      }
    }

    // Validate restart warning minutes
    if (serverInstance.scheduledRestartEnabled && serverInstance.restartWarningMinutes) {
      if (serverInstance.restartWarningMinutes < 1 || serverInstance.restartWarningMinutes > 60) {
        errors.push('Restart warning period must be between 1 and 60 minutes');
      }
    }

    // Validate restart time format
    if (serverInstance.scheduledRestartEnabled && serverInstance.restartTime) {
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(serverInstance.restartTime)) {
        errors.push('Restart time must be in HH:MM format (24-hour)');
      }
    }

    // Validate restart days for custom frequency
    if (serverInstance.scheduledRestartEnabled && 
        serverInstance.restartFrequency === 'custom' && 
        (!serverInstance.restartDays || serverInstance.restartDays.length === 0)) {
      errors.push('At least one day must be selected for custom restart frequency');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get default automation settings for a new server instance
   */
  getDefaultAutomationSettings(): Partial<ServerInstance> {
    return {
      autoStartOnAppLaunch: false,
      autoStartOnBoot: false,
      crashDetectionEnabled: false,
      crashDetectionInterval: 60,
      maxRestartAttempts: 3,
      scheduledRestartEnabled: false,
      restartFrequency: 'daily',
      restartTime: '02:00',
      restartDays: [1], // Monday
      restartWarningMinutes: 5
    };
  }
}