import { userDatabaseService } from './user-database.service';
import { getAllInstances, saveInstance } from '../../utils/ark/instance.utils';

/**
 * Stamp operatorUserId on servers that already have a manager.
 * Runs once the user database has attached those managers to an operator.
 * A server with no manager stays in the admin pool. An existing operatorUserId is left alone.
 * This only writes the panel's config.json. It does not start or stop a game server.
 */
export async function migrateServerOperators(): Promise<void> {
  const instances = await getAllInstances();
  for (const instance of instances) {
    if (!instance || instance.operatorUserId || !instance.managerUserId) continue;
    const manager = userDatabaseService.getUser(instance.managerUserId);
    const ownerId = manager?.ownerUserId || null;
    if (!ownerId) continue;
    const saved = await saveInstance({ ...instance, operatorUserId: ownerId });
    if (saved && (saved as any).error) {
      console.error(`[main] Could not record the operator for server "${instance.name || instance.id}": ${(saved as any).error}`);
      continue;
    }
    console.info(`[main] Server "${instance.name || instance.id}" is now in an operator group.`);
  }
}
