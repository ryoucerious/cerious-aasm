import { Injectable } from '@angular/core';
import { PlatformType } from '../types/platform.type';

@Injectable({ providedIn: 'root' })
export class UtilityService {

  getPlatform(): PlatformType {
    // Check for Electron environment using multiple detection methods
    const hasElectronProcess = window && (window as any).process && (window as any).process.type;
    const hasElectronAPI = window && (window as any).electronAPI;
    const hasRequire = window && (window as any).require;
    const userAgent = navigator.userAgent.toLowerCase().includes('electron');
    const isFileProtocol = window.location.protocol === 'file:';
    
    // In Electron, we'll either have node integration OR be loading from file:// protocol
    if (hasElectronProcess || hasElectronAPI || hasRequire || userAgent || isFileProtocol) {
      return 'Electron';
    }
    return 'Web';
  }

  /**
   * Check if value is an array
   */
  isArray(val: any): boolean {
    return Array.isArray(val);
  }

  /**
   * Format file size in human readable format
   */
  formatFileSize(bytes: number): string {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Safe date formatting method - displays dates in UTC
   */
  getFormattedDate(dateValue: any): string {
    if (!dateValue) return 'Unknown';
    
    try {
      let date: Date;
      
      if (dateValue instanceof Date) {
        date = dateValue;
      } else if (typeof dateValue === 'string') {
        date = new Date(dateValue);
      } else if (typeof dateValue === 'number') {
        // Handle timestamp (both seconds and milliseconds)
        date = dateValue > 1000000000000 ? new Date(dateValue) : new Date(dateValue * 1000);
      } else {
        console.warn('Unexpected date type:', typeof dateValue, dateValue);
        return 'Invalid Date';
      }
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        console.warn('Could not parse date:', dateValue);
        return 'Invalid Date';
      }
      
      // Format date in UTC with clear UTC indication
      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'UTC',
        hour12: true
      }).format(date) + ' UTC';
      
    } catch (error) {
      console.error('Error formatting date:', error, dateValue);
      return 'Format Error';
    }
  }

  /**
   * Download file from base64 data
   * Returns success/error status for the caller to handle notifications
   */
  downloadFileFromData(base64Data: string, fileName: string, mimeType: string): { success: boolean; error?: string } {
    try {
      // Convert base64 to blob
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      return { success: true };
    } catch (error) {
      console.error('Failed to download file:', error);
      return { success: false, error: 'Failed to download backup file' };
    }
  }
}
