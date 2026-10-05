import { randomUUID } from 'crypto';
import { COMMAND_SKEW_MS, type CommandResult, type ControlCommand } from '../../types/mesh.types';
import type { MeshRepository } from './mesh-repository';

export interface CommandEffect {
  (command: ControlCommand): Promise<CommandResult>;
}

/**
 * One CommandId produces one side effect. A retry after a lost response reads the stored result
 * and does not call the local runtime again.
 */
export async function executeCommand(
  repo: MeshRepository,
  command: ControlCommand,
  effect: CommandEffect,
  now = Date.now()
): Promise<CommandResult> {
  if (command.issuedAt > now + COMMAND_SKEW_MS) {
    return { success: false, error: 'Command timestamp is outside the allowed clock skew.' };
  }
  if (command.expiry < now - COMMAND_SKEW_MS) {
    return { success: false, error: 'Command has expired.' };
  }

  const existing = await repo.getCommand(command.commandId);
  if (existing && (existing.status === 'done' || existing.status === 'failed') && existing.result) {
    return existing.result;
  }
  if (!existing) {
    await repo.insertCommand({
      commandId: command.commandId,
      correlationId: command.correlationId,
      actor: command.actor,
      targetNode: command.targetNode,
      operation: command.operation,
      expiry: command.expiry,
      issuedAt: command.issuedAt,
      expectedRevision: command.expectedRevision,
      createdAt: now
    });
  }

  const claimed = await repo.claimCommand(command.commandId);
  if (!claimed) {
    const again = await repo.getCommand(command.commandId);
    if (again?.result && (again.status === 'done' || again.status === 'failed')) return again.result;
    return { success: false, error: 'Command is already running.' };
  }

  let result: CommandResult;
  try {
    result = await effect(command);
  } catch (error) {
    result = { success: false, error: error instanceof Error ? error.message : 'Command failed' };
  }
  await repo.completeCommand(command.commandId, result.success ? 'done' : 'failed', result);
  await repo.audit({
    eventId: randomUUID(),
    timestamp: Date.now(),
    actor: command.actor,
    nodeId: command.targetNode,
    action: command.operation,
    resource: command.serverId,
    result: result.success ? 'ok' : (result.error || 'failed'),
    correlationId: command.correlationId
  });
  return result;
}
