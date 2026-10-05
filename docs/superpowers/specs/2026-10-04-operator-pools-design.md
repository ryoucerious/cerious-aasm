# Operator pools: design

Date: 2026-10-04. Branch: `refactor/hardening`. Source of the idea: pull request ryoucerious/cerious-aasm#21, commit `a61fd066` ("Give each operator a separate pool of servers and accounts").

## Goal

Let an admin hand groups of servers and people to operators. Each operator runs one pool: the servers in it and the server managers, attendants and viewers who work them. Nobody outside a pool sees what is in it. Admins see everything.

The integration keeps the branch's existing methods: typed `onRequest` handlers, the node-sqlite3-wasm database service, the deny-by-default channel map as the single authorization boundary, session invalidation when rights change, and broadcast filtering decided in the main process.

## Decisions already made

- Role semantics follow the pull request (see Roles below).
- Nothing is migrated automatically. Existing accounts and servers stay in the admin pool until an admin moves them.
- Built-in roles are restored to their defined permissions on startup. A custom role is left as stored.
- Several admin accounts stay allowed. The existing "last active admin" protection stays.
- Pool checks are declared in the channel map, not inferred from payload keys.
- No per-message role re-read is added. Main already resolves each web user from the database per message.

## Vocabulary

- **Pool**: the admin pool (owner `null`) or one operator's pool (owner = that operator's user id).
- **Pool role**: Server Manager, Attendant or Viewer. These accounts have an owner. Admin and Operator accounts never do.
- **Assignee**: the one Server Manager or Attendant a server is assigned to.

## Data model

### Users

`users` gains `owner_user_id TEXT` (nullable). It is added in `applySchema` with the same "ALTER TABLE if the column is missing" pattern as `cli_locked`.

`User` and `AuthenticatedUser` (`electron/types/auth.types.ts`) gain `ownerUserId: string | null`. `SessionUser` does not carry it: main re-resolves the account per message and the web child never decides visibility from the snapshot.

`createUser` and `updateUser` accept `ownerUserId`. The service normalises it: admin and operator accounts always store `null`; a pool role may name an active operator or `null`; anything else is refused with "Choose an active operator for this pool."

### Server configs

`InstanceConfig` (`electron/types/server-instance.types.ts`) and the frontend `ServerInstance` gain:

- `operatorUserId?: string | null`: the pool. Absent or `null` is the admin pool.
- `managerUserId?: string | null`: the assignee. Absent or `null` is unassigned.

Both live in the instance's `config.json` like every other setting.

## Roles and permissions

New permissions, in the `Accounts` group of `PERMISSION_DESCRIPTIONS`:

| Permission | Meaning |
|---|---|
| `accounts.managers.create` | Add or edit a Server Manager in your pool |
| `accounts.managers.delete` | Delete a Server Manager in your pool |
| `accounts.attendants.create` | Add or edit an Attendant in your pool |
| `accounts.attendants.delete` | Delete an Attendant in your pool |
| `accounts.viewers.create` | Add or edit a Viewer in your pool |
| `accounts.viewers.delete` | Delete a Viewer in your pool |

`users.manage` is relabelled "Manage roles and all accounts". It keeps today's meaning: a non-admin holding it may manage any account whose permissions they hold themselves, and may edit roles.

Built-in role defaults (`BUILT_IN_ROLES`), used for fresh installs and for roles that are missing:

| Role | Permissions |
|---|---|
| Admin | everything, resolved dynamically |
| Operator | servers view/control/create/delete/configure, rcon.use, players view/manage, backups view/create/restore/delete, mods.manage, automation.manage, all six `accounts.*` |
| Server Manager | servers view/control/configure, rcon.use, players view/manage, backups view/create/restore/delete, mods.manage, automation.manage |
| Attendant (new, id `attendant`) | servers view/control, players view |
| Viewer | servers view, players view |

Consequence for existing installs: each startup writes the built-in permission sets back, so a Server Manager loses Create servers and Delete servers, and an Operator gains them along with the `accounts.*` permissions. A custom role is left as stored. The Attendant role is inserted on first start.

`ROLE_IDS` gains `ATTENDANT`. `isAssignableRole(roleId)` is true for Server Manager and Attendant.

## Visibility rules

`electron/services/auth/pool-access.ts`, pure functions with no database access:

- `isPoolRole(roleId)`: Server Manager, Attendant or Viewer.
- `accountPermission(roleId, 'create' | 'delete')`: the `accounts.*` permission for that pool role, or `null`.
- `instanceVisibleTo(user, instance)`:
  - Operator: `instance.operatorUserId === user.id`.
  - Viewer: `instance.operatorUserId` equals the viewer's `ownerUserId` (both `null` for the admin pool).
  - Server Manager or Attendant: `instance.managerUserId === user.id`.
  - Any other non-admin role: the admin pool only (`operatorUserId` is `null`).
- `filterInstancesForUser(user, instances)`.

Admin accounts, the desktop window and auth-off web sockets are handled by the callers and never reach these rules.

## Request gating

### Channel map

`CHANNEL_PERMISSIONS` entries become `ChannelRule`:

```ts
type ChannelRule =
  | Permission
  | null
  | {
      permission?: Permission;
      anyOf?: Permission[];
      /** Payload key that names the server(s) this call is about. */
      instance?: 'id' | 'instanceId' | 'serverId' | 'targetId' | 'orderedIds' | 'instance.id';
    };
```

A plain `Permission` or `null` keeps its current meaning. `permissionForChannel` and `isChannelAllowed` are updated to read the object form. A test asserts that every channel whose handler reads a server id declares `instance`.

Declared keys:

| Key | Channels |
|---|---|
| `id` | get-server-instance, get-server-instance-state, get-server-instance-logs, get-server-instance-players, get-rcon-status, start-server-instance, stop-server-instance, force-stop-server-instance, connect-rcon, disconnect-rcon, rcon-command, get-online-players, delete-server-instance, export-server-config, open-directory |
| `instanceId` | get-ini-file, save-ini-file, every backup channel, every ark-api channel, every whitelist channel, assign-server-manager |
| `serverId` | every automation channel except auto-start-on-app-launch |
| `targetId` | import-server-config |
| `orderedIds` | reorder-server-instances |
| `instance.id` | save-server-instance |

`save-server-instance` becomes `{ anyOf: ['servers.create', 'servers.configure'], instance: 'instance.id' }`; the handler refuses creating without `servers.create` and editing without `servers.configure`.

Account channels: `get-users`, `get-roles`, `create-user`, `update-user`, `delete-user` become `{ anyOf: ['users.manage', ...all six accounts.*] }`. Role channels stay `users.manage`. New channel `list-pool-labels` is `servers.view`. New channel `set-server-operator` has no entry, so only an admin may call it.

### The gate

`authorizeChannel` keeps its shape. After the permission check passes for a non-admin, if the rule declares `instance`, the gate reads that key from the payload (a string, or an array of strings for `orderedIds`), loads each instance with `getInstance`, and refuses the call with "That server is not in your pool." when any loaded instance fails `instanceVisibleTo`. An id that names no instance is left for the handler, which already answers "not found".

For `save-server-instance` with no `instance.id` (a new server) the scope check is skipped; the handler decides the pool.

### Handlers that filter lists

- `get-server-instances`: `filterInstancesForUser` for non-admins.
- `start-all-instances` and `stop-all-instances`: scoped to the visible ids. `startAllInstances` and `stopAllInstances` in the lifecycle service take an optional `onlyIds: string[]`.
- `get-activity`: a non-admin sees entries whose `instanceId` they may see. Entries without an instance are admin-only.
- `get-player-history`: a non-admin receives each sample with the counts of invisible servers removed.

### Account rules (user handler)

Three kinds of caller:

1. **Admin or desktop**: everything, plus the `ownerUserId` field on create and update.
2. **Non-admin with `users.manage`**: today's rules (cannot touch admins, cannot hand out permissions they lack), plus `ownerUserId` is accepted as given.
3. **Pool owner** (holds at least one `accounts.*`, not `users.manage`): sees only accounts whose owner is themselves; may create or edit a pool role only when holding its `create` permission; may delete only when holding its `delete` permission; `ownerUserId` is forced to themselves; cannot create Admin or Operator accounts.

Guards for everyone except where stated:

- You cannot change your own role, disable or delete yourself (existing).
- An Operator who still owns accounts or servers cannot be deleted.
- An assignee who still has servers cannot be deleted, cannot be moved to another pool, and cannot be given a non-assignable role.
- Moving an account between pools is admin-only.

`get-users` returns the same shape as today plus `ownerUserId` on each user. `users-changed` and session invalidation stay as they are.

### Server ownership (server-instance handler)

`electron/services/auth/server-ownership.ts` holds the rules; the handler calls them.

- `save-server-instance`, new server: an Operator's server goes in their pool; an admin's goes where `operatorUserId` says (validated as an active operator) or the admin pool; a Server Manager creating is refused unless they hold `servers.create`, in which case the server is assigned to them in their owner's pool.
- `save-server-instance`, existing server: `operatorUserId` and `managerUserId` are taken from the stored config unless the caller is an admin (operator) or an admin or the pool's operator (assignee). Any assignee must be active, assignable, and owned by the server's pool.
- `assign-server-manager { instanceId, managerUserId | null }`: admin or the pool's operator. Same assignee validation.
- `set-server-operator { instanceId, operatorUserId | null }`: admin only. Clears the assignee when they are not in the new pool.
- `import-server-from-backup`: the new server lands in the caller's pool as a new server does.
- `delete-server-instance`: pool-scoped through the map.

Both new channels reply `{ success, instance }` and then broadcast `server-instance-updated` and `server-instances`.

### `list-pool-labels`

Returns `{ operators, assignees }` as `{ id, username, displayName, roleName }` lists for the server card and the ownership dropdowns: an admin receives every active operator and assignee; an operator receives themselves and their pool; a pool member receives the operator and assignee of the servers they can see.

## Broadcast scoping

Decided in main. `MessagingService.broadcastToWebClients` passes each broadcast through `electron/services/auth/pool-broadcast.ts`, which returns one or more `{ data, audience }` messages. `MainToChildMessage` `broadcast-web` gains an optional `audience`:

```ts
audience?: {
  /** Account ids that receive this message. */
  userIds: string[];
  /** Also the sockets with no account: auth off, or the legacy single login. */
  owners: boolean;
}
```

The child (`sendToAllWebSockets`) sends to every socket when `audience` is absent. With an audience it sends to sockets whose `_user.id` is listed, and to sockets whose `_user` is `null` or `LEGACY_ADMIN_ID` when `owners` is true.

Which broadcasts are scoped, declared in `pool-broadcast.ts`:

| Channel | Rule |
|---|---|
| `server-instances` | one message per distinct visible set, plus the full list for admins and owners |
| `server-instance-updated` | audience = users who can see `data.id`, plus admins and owners |
| `server-instance-state`, `server-instance-log`, `server-instance-players`, `server-instance-memory`, `server-instance-cpu`, `rcon-status`, `clear-server-instance-logs`, `backup-created`, and `notification` when it carries `instanceId` | audience = users who can see `data.instanceId`, plus admins and owners |
| everything else | unscoped |

`notification` payloads from instance handlers gain `instanceId`, as in the pull request, so they can be scoped.

The audience is built from a `PoolDirectory` in main: active users (id, roleId, ownerUserId) and instance ownership (id, operatorUserId, managerUserId), held in memory. It is marked stale by `broadcastUsersChanged` and by `saveInstance` and `deleteInstance` in `instance.utils`, and reloads on the next use. Fast path: when no active non-admin account exists, every broadcast is unscoped and the directory is not consulted.

Renderer windows (the desktop app) are never filtered.

## Frontend

- `auth.model.ts` and `server-instance.model.ts` mirror the new fields, permissions and role id. `accountPermissionFor(roleId, action)` mirrors `accountPermission`.
- `AuthService` gains `listPoolLabels`, `assignServerManager`, `setServerOperator`; `createUser` and `updateUser` accept `ownerUserId`.
- `PoolDirectoryService`: loads `list-pool-labels` whenever the identity changes or `users-changed` or `server-instances` arrives, and exposes `operatorLabel(server)` and `assigneeLabel(server)`.
- Users page: a Pool column ("Admin pool", or the operator's name); an owner dropdown shown to admins when the role is a pool role; role choices limited to roles the current user may create; edit and delete buttons hidden when the current user may not; the "Add user" button hidden when no role may be created.
- General tab: an Ownership block at the top. Operator dropdown for admins (calls `set-server-operator`), assignee dropdown for admins and the pool's operator (calls `assign-server-manager`), labels only for everyone else.
- Server card: a named operator, a named assignee and the join address sit with the session name under the artwork. "Admin" and "Not assigned" are not shown. Server name, map and status stay on the artwork. The sidebar shows the same names, and nothing in that spot when neither name exists. `canConfigure` and `canBackups` inputs so the menu matches the role.
- Dashboard and sidebar: Add Server needs `servers.create`; delete needs `servers.delete`; rename needs `servers.configure`.
- Server page: the RCON panel needs `rcon.use`.

The backend enforces all of this; the UI only hides what cannot be done.

## Error handling

Every refusal is a `{ success: false, error }` reply with a sentence the UI can show. The gate's scope refusal uses `forbidden: true` like its permission refusal. Database failures inside the directory never block a broadcast: on error the broadcast goes out to admins and owners only, and the error is logged.

## Testing

Jest (electron):

- `pool-access.test.ts`: every rule in `instanceVisibleTo`, `accountPermission`.
- `channel-permissions.test.ts`: object rules resolve; every instance-bearing handler channel declares a key (list kept in the test).
- `permission-gate.test.ts`: scope refusals, `orderedIds`, missing instance left to the handler, admins unaffected.
- `user-handler.test.ts`: the three caller kinds, every guard.
- `server-instance-handler.test.ts`: pool stamping on create, assignee validation, the two new channels, scoped start-all and stop-all.
- `pool-broadcast.test.ts`: audiences per channel, the fast path, the directory going stale.
- `user-database.service.test.ts`: the column migration, owner normalisation, Attendant seeded, edited roles untouched.
- `ipc-handlers.test.ts`: the child honours `audience`.

Karma (Angular): users page gating and pool column, server card labels, general tab ownership block, dashboard and server page gating.

## Out of scope

- Automatic adoption of existing accounts into an operator's pool.
- A "reset to defaults" action for built-in roles.
- A single-admin rule.
- Per-message role refresh from the database.
