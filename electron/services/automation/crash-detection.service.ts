import * as path from 'path';
import { serverInstanceService } from '../server-instance/server-instance.service';
import { serverProcessService } from '../server-instance/server-process.service';
import { getStandardEventCallbacks } from '../server-instance/instance-events';
import { areServerFilesUpdating } from '../../utils/ark/ark-server/ark-server-state.utils';
import { getInstanceLogsDir } from '../../utils/ark/ark-server/ark-server-paths.utils';
import { readLogTail } from '../../utils/ark/ark-server/ark-server-logging.utils';
import { getInstance } from '../../utils/ark/instance.utils';
import { discordService } from '../discord.service';
import { ServerAutomation } from '../../types/automation.types';
import { createServerAutomation } from './automation-defaults';

const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 300;
// After an exit: the leftover sweep and the RCON disconnect settle first.
const CRASH_SETTLE_MS = 5000;
// Between restarts after a failure that was not the server's, such as CurseForge being down.
const RECOVERABLE_BACKOFF_MS = [60_000, 120_000, 300_000, 600_000];
const LOG_TAIL_LINES = 200;
// ARK exits (code 0) when CurseForge cannot list the server's mods: a later start succeeds.
const MODS_UNAVAILABLE = /Requested mods failed to load|LogCFCore: Error querying server mods|serverUnreachable/i;

/** crashDetectionInterval is in seconds; hand-edited values are held to the UI's 30-300. */
function intervalMs(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_INTERVAL_SECONDS * 1000;
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, seconds)) * 1000;
}

/** Whether the server's last log says its mods could not be fetched, rather than that it broke. */
function modsWereUnavailable(serverId: string): boolean {
  try {
    const log = path.join(getInstanceLogsDir(serverId), 'ShooterGame.log');
    return readLogTail(log, LOG_TAIL_LINES).some(line => MODS_UNAVAILABLE.test(line));
  } catch {
    return false;
  }
}

/**
 * Restarts servers that crashed. The process service records an exit nobody asked for as
 * 'crashed' and reports it (handleCrash); this also polls for that state, and restarts up to
 * maxRestartAttempts in a row. A start that fails because CurseForge could not serve the mods
 * is retried with a backoff for as long as it takes, without using up an attempt.
 */
export class CrashDetectionService {
  private automations: Map<string, ServerAutomation>;
  private readonly restarting = new Set<string>();

  constructor(automations: Map<string, ServerAutomation>) {
    this.automations = automations;
  }

  startCrashDetection(serverId: string): void {
    const automation = this.automations.get(serverId);
    if (!automation) return;

    this.stopCrashDetection(serverId);
    automation.status.isMonitoring = true;
    automation.crashDetectionTimer = setInterval(() => {
      void this.checkForCrash(serverId);
    }, intervalMs(automation.settings.crashDetectionInterval));
  }

  stopCrashDetection(serverId: string): void {
    const automation = this.automations.get(serverId);
    if (!automation) return;

    if (automation.crashDetectionTimer) {
      clearInterval(automation.crashDetectionTimer);
      automation.crashDetectionTimer = undefined;
    }
    this.clearRetry(automation);
    automation.status.isMonitoring = false;
  }

  /**
   * A server's process just exited while starting or running. Checks it shortly, rather than on
   * the next poll, and first takes the settings from its config.json: they can reach it without
   * this record knowing (a move from another machine, a restore, a save made on a mesh peer).
   */
  handleCrash(serverId: string): void {
    const automation = this.refreshSettings(serverId);
    if (!automation) {
      console.log(`[crash-detection] ${serverId} crashed; not restarting it: it has no automation settings`);
      return;
    }
    if (!automation.settings.crashDetectionEnabled) {
      console.log(`[crash-detection] ${serverId} crashed; not restarting it: crash detection is off for it`);
      return;
    }
    if (!automation.crashDetectionTimer) {
      // Enabled on disk with nothing armed here: the poll starts now, as if saved from this machine.
      console.warn(`[crash-detection] ${serverId} has crash detection on but it was not armed; arming it now`);
      this.startCrashDetection(serverId);
    }

    automation.recoverableCrash = modsWereUnavailable(serverId);
    let delay = CRASH_SETTLE_MS;
    if (automation.recoverableCrash) {
      const retries = automation.recoverableRetries ?? 0;
      delay = RECOVERABLE_BACKOFF_MS[Math.min(retries, RECOVERABLE_BACKOFF_MS.length - 1)];
      automation.recoverableRetries = retries + 1;
      console.warn(`[crash-detection] ${serverId} could not load its mods from CurseForge; retrying in ${delay / 1000}s without using a restart attempt`);
    }

    this.clearRetry(automation);
    automation.crashRetryTimer = setTimeout(() => {
      automation.crashRetryTimer = undefined;
      void this.checkForCrash(serverId);
    }, delay);
  }

  /** The record, with the crash settings its config.json holds now. Created if this run had none. */
  private refreshSettings(serverId: string): ServerAutomation | undefined {
    let stored: ReturnType<typeof getInstance> = null;
    try {
      stored = getInstance(serverId);
    } catch (error) {
      console.error(`[crash-detection] Could not read the settings of ${serverId}:`, error);
    }
    let automation = this.automations.get(serverId);
    if (!stored) return automation;

    const fresh = createServerAutomation(serverId, stored).settings;
    if (!automation) {
      automation = createServerAutomation(serverId, stored);
      this.automations.set(serverId, automation);
      return automation;
    }
    const { crashDetectionEnabled, crashDetectionInterval, maxRestartAttempts } = fresh;
    const intervalChanged = automation.settings.crashDetectionInterval !== crashDetectionInterval;
    Object.assign(automation.settings, { crashDetectionEnabled, crashDetectionInterval, maxRestartAttempts });
    if (!crashDetectionEnabled && automation.crashDetectionTimer) this.stopCrashDetection(serverId);
    else if (intervalChanged && automation.crashDetectionTimer) this.startCrashDetection(serverId);
    return automation;
  }

  private clearRetry(automation: ServerAutomation): void {
    if (automation.crashRetryTimer) {
      clearTimeout(automation.crashRetryTimer);
      automation.crashRetryTimer = undefined;
    }
  }

  private async checkForCrash(serverId: string): Promise<void> {
    const automation = this.automations.get(serverId);
    if (!automation) return;

    try {
      const state = serverProcessService.getInstanceState(serverId);
      if (state === 'running' && serverProcessService.hasActiveProcess(serverId)) {
        automation.restartAttempts = 0;
        automation.recoverableRetries = 0;
        automation.recoverableCrash = false;
        return;
      }
      if (state !== 'crashed') return;

      // A crashed server left alone is the case to explain: a silent skip reads as recovery being on.
      const skip = (reason: string) => console.log(`[crash-detection] Not restarting ${serverId} yet: ${reason}`);
      // A restart can outlast the interval: the state stays 'crashed' until the new process spawns.
      if (this.restarting.has(serverId)) return skip('a restart is already in progress');
      // During an install or update the start would be refused, and must not use up an attempt.
      if (areServerFilesUpdating()) return skip('the server files are being installed or updated');
      if (serverProcessService.hasActiveProcess(serverId)) return skip('its process is still running');
      if (automation.manuallyStopped) return skip('it was stopped by hand');
      // The poll waits for a backoff handleCrash set.
      if (automation.crashRetryTimer) return skip('waiting out the retry delay');

      const { maxRestartAttempts } = automation.settings;
      let message: string;
      if (automation.recoverableCrash) {
        message = `Its mods could not be loaded from CurseForge; restarting it (retry ${automation.recoverableRetries ?? 1}).`;
      } else {
        if (automation.restartAttempts >= maxRestartAttempts) {
          console.warn(`[crash-detection] ${serverId} crashed after ${maxRestartAttempts} restarts; no longer restarting it`);
          this.stopCrashDetection(serverId);
          return;
        }
        automation.restartAttempts++;
        message = `Attempting an automatic restart after a crash (${automation.restartAttempts}/${maxRestartAttempts}).`;
      }
      automation.lastCrashTime = new Date();
      discordService.sendNotification(serverId, 'crash', message);
      console.log(`[crash-detection] Restarting ${serverId}: ${message}`);

      this.restarting.add(serverId);
      try {
        const { onLog, onState } = getStandardEventCallbacks(serverId);
        const result = await serverInstanceService.startServerInstance(serverId, onLog, onState);
        if (!result.started) {
          console.error(`[crash-detection] Could not restart ${serverId}: ${result.portError}`);
        }
      } finally {
        this.restarting.delete(serverId);
      }
    } catch (error) {
      console.error(`[crash-detection] Check failed for ${serverId}:`, error);
    }
  }
}
