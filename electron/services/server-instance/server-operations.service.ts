import { validateInstanceId } from '../../utils/validation.utils';
import * as instanceUtils from '../../utils/ark/instance.utils';
import type { RconResult } from '../../types/server-instance.types';
import { automationService } from '../automation/automation.service';
import { messagingService } from '../messaging.service';
import { rconService } from '../rcon.service';
import { serverProcessService } from './server-process.service';

// Commands that shut the server down.
const SHUTDOWN_COMMAND = /^(admincheat\s+|cheat\s+)?(doexit|quit|exit)\b/i;
// As long as a stop waits for the process after DoExit.
const SHUTDOWN_EXIT_GRACE_MS = 2 * 60 * 1000;

/** RCON requests from clients: validates the instance before it reaches the RCON service. */
export class ServerOperationsService {
  private readonly shutdownChecks = new Map<string, NodeJS.Timeout>();

  async connectRcon(instanceId: string): Promise<RconResult> {
    try {
      if (!validateInstanceId(instanceId)) {
        return { success: false, error: 'Invalid instance ID', instanceId, connected: false };
      }
      if (!instanceUtils.getInstance(instanceId)) {
        return { success: false, error: 'Instance not found', instanceId, connected: false };
      }

      const { connected } = await rconService.connectRcon(instanceId);
      return { success: true, connected, instanceId };
    } catch (error) {
      console.error('[server-operations] Failed to connect RCON:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect RCON',
        instanceId,
        connected: false
      };
    }
  }

  async disconnectRcon(instanceId: string): Promise<RconResult> {
    try {
      await rconService.disconnectRcon(instanceId);
      return { success: true, connected: false, instanceId };
    } catch (error) {
      console.error('[server-operations] Failed to disconnect RCON:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disconnect RCON',
        instanceId,
        connected: false
      };
    }
  }

  /**
   * Marks a server being shut down from the RCON console as stopping, before the command is sent:
   * the process may exit before any response, and an exit while running reads as a crash. Returns
   * the state it replaced, or null when it left the state alone.
   */
  private markStoppingByHand(instanceId: string): string | null {
    // Without a connection the command is never sent.
    if (!rconService.getRconStatus(instanceId).connected) return null;
    const state = serverProcessService.getNormalizedInstanceState(instanceId);
    if (state !== 'running' && state !== 'starting') return null;

    this.setStateByHand(instanceId, 'stopping', true);
    return state;
  }

  /**
   * A server still up after as long as a stop waits for one ignored the command. Left 'stopping',
   * its next crash would be taken for this stop and not restarted.
   */
  private unmarkIfStillUp(instanceId: string, previousState: string): void {
    clearTimeout(this.shutdownChecks.get(instanceId));
    const check = setTimeout(() => {
      this.shutdownChecks.delete(instanceId);
      if (serverProcessService.hasActiveProcess(instanceId)) {
        this.unmarkStoppingByHand(instanceId, previousState);
      }
    }, SHUTDOWN_EXIT_GRACE_MS);
    check.unref();
    this.shutdownChecks.set(instanceId, check);
  }

  /** Puts back the state a shutdown command replaced, unless a stop or an exit has taken over since. */
  private unmarkStoppingByHand(instanceId: string, previousState: string): void {
    // A stop begun meanwhile owns the mark: put back to running, its exit would read as a crash.
    if (serverProcessService.isStopInProgress(instanceId)) return;
    // The process may have exited meanwhile, for a reason of its own.
    if (serverProcessService.getNormalizedInstanceState(instanceId) !== 'stopping') return;
    this.setStateByHand(instanceId, previousState, false);
  }

  private setStateByHand(instanceId: string, state: string, manuallyStopped: boolean): void {
    serverProcessService.setInstanceState(instanceId, state);
    automationService.setManuallyStopped(instanceId, manuallyStopped);
    messagingService.sendToAll('server-instance-state', { state, instanceId });
  }

  getRconStatus(instanceId: string): RconResult {
    const { success, connected, instanceId: id } = rconService.getRconStatus(instanceId);
    return { success, connected, instanceId: id };
  }

  async executeRconCommand(instanceId: string, command: string): Promise<RconResult> {
    try {
      if (!validateInstanceId(instanceId)) {
        return { success: false, error: 'Invalid instance ID', instanceId };
      }
      if (!command || typeof command !== 'string') {
        return { success: false, error: 'Invalid command', instanceId };
      }

      const replacedState = SHUTDOWN_COMMAND.test(command.trim()) ? this.markStoppingByHand(instanceId) : null;
      const { success, response, error, notSent } = await rconService.executeRconCommand(instanceId, command);
      if (replacedState && notSent) {
        this.unmarkStoppingByHand(instanceId, replacedState);
      } else if (replacedState) {
        this.unmarkIfStillUp(instanceId, replacedState);
      }
      return { success, response, error, instanceId };
    } catch (error) {
      console.error('[server-operations] Failed to execute RCON command:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute RCON command',
        instanceId
      };
    }
  }
}

export const serverOperationsService = new ServerOperationsService();
