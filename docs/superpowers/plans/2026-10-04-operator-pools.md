# Operator Pools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each operator a pool of servers and accounts that only its members can see, enforced on the message bus and in broadcasts, with the admin seeing everything.

**Architecture:** Ownership lives on users (`owner_user_id`) and server configs (`operatorUserId`, `managerUserId`). One pure module decides visibility. The channel map declares which payload key names a server, and the gate refuses calls outside the caller's pool before any handler runs. Broadcasts are given an audience in main and the web child only matches socket user ids.

**Tech Stack:** Electron main (TypeScript, node-sqlite3-wasm, jest), Angular 17 standalone components (Karma/Jasmine).

**Spec:** `docs/superpowers/specs/2026-10-04-operator-pools-design.md`

## Global Constraints

- Source files keep the repository's CRLF line endings. Write a new file as CRLF; never let a tool flip an existing file. Check with `git diff --stat` that only intended lines changed.
- Electron tests: `npx jest --config jest.electron.config.js <path>`. Angular tests: `npx ng test --watch=false --browsers=ChromeHeadless --include='<glob>'`. Type check: `npx tsc -p tsconfig.electron.json --noEmit`.
- Handlers use `onRequest` from `electron/handlers/handler.utils.ts` and typed `MessageSender`; never `messagingService.on` with `any`.
- Database access goes through `UserDatabaseService` (`queryOne`, `queryAll`, `conn.run`). The web child never opens the database.
- Permission strings are the contract: `electron/types/auth.types.ts` and `src/app/core/models/auth.model.ts` must list the same values.
- Existing stored roles are never rewritten; only missing roles are inserted.
- Every refusal is `{ success: false, error: <sentence> }`; the gate adds `forbidden: true`.
- The exact refusal sentences from the spec are used verbatim where the spec gives them: "That server is not in your pool.", "Choose an active operator for this pool."

## Review Focus

1. A pool owner edits a user and sends `ownerUserId` of another operator: must be ignored (forced to themselves). Pinned in Task 6.
2. `reorder-server-instances` from an operator whose list contains a server outside their pool: must be refused by the gate, not partially applied. Pinned in Task 5.
3. A server whose `managerUserId` names a user that was deleted or demoted: the card shows "Not assigned" and `assign-server-manager` can clear it; `save-server-instance` must not refuse an unrelated edit because of the stale id when the caller is not touching the assignee. Pinned in Task 7.
4. `server-instances` broadcast when an operator has no visible servers: they must receive an empty list, not nothing (otherwise their dashboard keeps stale servers). Pinned in Task 9.
5. Auth off (`authEnabled: false`) with pool-scoped broadcasts: every socket must still receive everything. Pinned in Task 9.

---

### Task 1: Permissions, roles and ownership fields in the shared types

**Files:**
- Modify: `electron/types/auth.types.ts`
- Modify: `electron/types/server-instance.types.ts` (the `InstanceConfig` interface)
- Modify: `src/app/core/models/auth.model.ts`
- Modify: `src/app/core/models/server-instance.model.ts`
- Create: `electron/types/auth.types.test.ts`

**Interfaces:**
- Produces: `PERMISSIONS.ACCOUNTS_MANAGERS_CREATE = 'accounts.managers.create'`, `ACCOUNTS_MANAGERS_DELETE`, `ACCOUNTS_ATTENDANTS_CREATE`, `ACCOUNTS_ATTENDANTS_DELETE`, `ACCOUNTS_VIEWERS_CREATE`, `ACCOUNTS_VIEWERS_DELETE` (values `accounts.<kind>.<action>`), `ROLE_IDS.ATTENDANT = 'attendant'`, `isAssignableRole(roleId: string | null | undefined): boolean`, `User.ownerUserId: string | null`, `InstanceConfig.operatorUserId?: string | null`, `InstanceConfig.managerUserId?: string | null`. Frontend: same permissions, `ATTENDANT_ROLE_ID`, `OPERATOR_ROLE_ID`, `SERVER_MANAGER_ROLE_ID`, `VIEWER_ROLE_ID` constants, `User.ownerUserId?: string | null`, `ServerInstance.operatorUserId?`, `ServerInstance.managerUserId?`, `accountPermissionFor(roleId: string, action: 'create' | 'delete'): Permission | null`.

- [ ] **Step 1: Write the failing test** `electron/types/auth.types.test.ts`

```ts
import { ALL_PERMISSIONS, BUILT_IN_ROLES, PERMISSION_DESCRIPTIONS, PERMISSIONS, ROLE_IDS, isAssignableRole } from './auth.types';

describe('auth.types', () => {
  it('describes every permission, including the six account permissions', () => {
    expect(PERMISSIONS.ACCOUNTS_ATTENDANTS_DELETE).toBe('accounts.attendants.delete');
    for (const permission of ALL_PERMISSIONS) expect(PERMISSION_DESCRIPTIONS[permission].group).toBeTruthy();
    expect(ALL_PERMISSIONS.filter(p => p.startsWith('accounts.'))).toHaveLength(6);
  });

  it('defines the attendant role with view and control only', () => {
    const attendant = BUILT_IN_ROLES.find(role => role.id === ROLE_IDS.ATTENDANT)!;
    expect(attendant.permissions).toEqual([PERMISSIONS.SERVERS_VIEW, PERMISSIONS.SERVERS_CONTROL]);
  });

  it('gives the operator the pool permissions and the server manager none of them', () => {
    const operator = BUILT_IN_ROLES.find(role => role.id === ROLE_IDS.OPERATOR)!;
    const manager = BUILT_IN_ROLES.find(role => role.id === ROLE_IDS.SERVER_MANAGER)!;
    expect(operator.permissions).toEqual(expect.arrayContaining([PERMISSIONS.SERVERS_CREATE, PERMISSIONS.SERVERS_DELETE, PERMISSIONS.ACCOUNTS_VIEWERS_DELETE]));
    expect(manager.permissions).not.toContain(PERMISSIONS.SERVERS_CREATE);
    expect(manager.permissions).not.toContain(PERMISSIONS.SETTINGS_VIEW);
  });

  it('treats server managers and attendants as assignable', () => {
    expect(isAssignableRole('server-manager')).toBe(true);
    expect(isAssignableRole('attendant')).toBe(true);
    expect(isAssignableRole('viewer')).toBe(false);
    expect(isAssignableRole(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** with "ACCOUNTS_ATTENDANTS_DELETE" undefined / `isAssignableRole` not exported.

- [ ] **Step 3: Implement** in `electron/types/auth.types.ts`: the six permissions with descriptions in group `Accounts` (labels "Add server managers", "Delete server managers", etc.); relabel `USERS_MANAGE` to "Manage roles and all accounts"; `ROLE_IDS.ATTENDANT`; `isAssignableRole`; `User.ownerUserId: string | null`; `BUILT_IN_ROLES` per the spec's role table (Attendant description: "Can start, stop and read the console of the servers assigned to them."). Add the two optional fields to `InstanceConfig`. Mirror all of it in `src/app/core/models/auth.model.ts` (plus `accountPermissionFor`) and `src/app/core/models/server-instance.model.ts`.

- [ ] **Step 4: Run the test and the electron type check**; fix any place `User` is built without `ownerUserId` (expect `toUser` in the database service, test helpers in `permission-gate.test.ts`, `user-handler.test.ts`, `web-server.service` legacy admin). Add `ownerUserId: null` there.

- [ ] **Step 5: Commit** `feat(auth): account permissions, attendant role, ownership fields`

---

### Task 2: Owner column and normalisation in the user database

**Files:**
- Modify: `electron/services/auth/user-database.service.ts`
- Test: `electron/services/auth/user-database.service.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces: `CreateUserInput.ownerUserId?: string | null`, `UpdateUserInput.ownerUserId?: string | null` (present means set), `User.ownerUserId` read from `owner_user_id`, `listUsers()` and `getUser()` unchanged in shape.

- [ ] **Step 1: Write the failing tests** (append a `describe('pools', ...)` to the existing file, using its `createUser` helper):

```ts
it('adds the owner column to a database created before pools', () => {
  // The schema already ran in beforeEach; re-running initialize on a second service must not fail
  // and the column must be present.
  const again = new UserDatabaseService();
  again.initialize();
  expect(again.listUsers()).toEqual([]);
  again.close();
});

it('stores a pool account under an active operator', async () => {
  const operator = await createUser('op', 'operator');
  const result = await service.createUser({ username: 'm', password: 'password1', roleId: 'server-manager', ownerUserId: operator.id });
  expect(result).toMatchObject({ success: true, data: { ownerUserId: operator.id } });
});

it('refuses an owner that is not an active operator', async () => {
  const viewer = await createUser('v', 'viewer');
  const result = await service.createUser({ username: 'm', password: 'password1', roleId: 'server-manager', ownerUserId: viewer.id });
  expect(result).toEqual({ success: false, error: 'Choose an active operator for this pool.' });
});

it('never stores an owner on an admin or operator account', async () => {
  const operator = await createUser('op', 'operator');
  const other = await service.createUser({ username: 'op2', password: 'password1', roleId: 'operator', ownerUserId: operator.id });
  expect(other).toMatchObject({ success: true, data: { ownerUserId: null } });
});

it('moves an account between pools on update and keeps it when the field is absent', async () => {
  const a = await createUser('a', 'operator');
  const b = await createUser('b', 'operator');
  const m = (await service.createUser({ username: 'm', password: 'password1', roleId: 'viewer', ownerUserId: a.id })).data!;
  expect(await service.updateUser({ id: m.id, displayName: 'M' })).toMatchObject({ success: true, data: { ownerUserId: a.id } });
  expect(await service.updateUser({ id: m.id, ownerUserId: b.id })).toMatchObject({ success: true, data: { ownerUserId: b.id } });
  expect(await service.updateUser({ id: m.id, ownerUserId: null })).toMatchObject({ success: true, data: { ownerUserId: null } });
});

it('seeds the attendant role and leaves an edited built-in role alone', () => {
  expect(service.getRole('attendant')).toMatchObject({ builtIn: true, permissions: ['servers.view', 'servers.control'] });
  service.updateRole({ id: 'viewer', name: 'Viewer', permissions: ['servers.view'] });
  const again = new UserDatabaseService();
  again.initialize();
  expect(again.getRole('viewer')!.permissions).toEqual(['servers.view']);
  again.close();
});
```

- [ ] **Step 2: Run them to verify they fail** (unknown column / `ownerUserId` undefined).

- [ ] **Step 3: Implement**: `UserRow.owner_user_id: string | null`; `applySchema` adds `owner_user_id TEXT` when `PRAGMA table_info(users)` lacks it; `private normalizeOwner(roleId: string, ownerUserId: string | null | undefined): { owner: string | null; error?: string }` (admin/operator → `null`; falsy → `null`; otherwise the user must exist, be active and be an operator); `createUser` and `updateUser` bind the column; `toUser` maps it. `seedBuiltInRoles` is unchanged (it already inserts only missing roles).

- [ ] **Step 4: Run the database test file and the type check**; expect all green.

- [ ] **Step 5: Commit** `feat(auth): owner column and pool normalisation`

---

### Task 3: Visibility rules

**Files:**
- Create: `electron/services/auth/pool-access.ts`
- Create: `electron/services/auth/pool-access.test.ts`

**Interfaces:**
- Produces:
  - `type PoolUser = { id: string; roleId: string; ownerUserId?: string | null }`
  - `type PoolInstance = { operatorUserId?: string | null; managerUserId?: string | null }`
  - `isPoolRole(roleId: string | null | undefined): boolean`
  - `accountPermission(roleId: string | null | undefined, action: 'create' | 'delete'): Permission | null`
  - `holdsAccountPermission(permissions: readonly Permission[], roleId: string | null | undefined, action: 'create' | 'delete'): boolean`
  - `isPoolOwnerIdentity(permissions: readonly Permission[]): boolean` (holds any `accounts.*`)
  - `instanceVisibleTo(user: PoolUser | null | undefined, instance: PoolInstance | null | undefined): boolean`
  - `filterInstancesForUser<T extends PoolInstance>(user: PoolUser | null | undefined, instances: T[]): T[]` (admin role id → all)

- [ ] **Step 1: Write the failing tests** covering: operator sees own pool only; viewer sees owner's pool (admin pool when `ownerUserId` null); manager and attendant see assigned servers only; a custom role sees the admin pool only; `accountPermission('viewer','delete') === 'accounts.viewers.delete'`, `accountPermission('operator','create') === null`; `filterInstancesForUser` returns everything for an admin user and `[]` for `null`.

- [ ] **Step 2: Run to verify failure** (module not found).

- [ ] **Step 3: Implement** the pure functions. No imports beyond `auth.types`.

- [ ] **Step 4: Run tests; green.**

- [ ] **Step 5: Commit** `feat(auth): pool visibility rules`

---

### Task 4: Channel rules with instance keys and `anyOf`

**Files:**
- Modify: `electron/services/auth/channel-permissions.ts`
- Create: `electron/services/auth/channel-permissions.test.ts`

**Interfaces:**
- Produces:
  - `type InstanceKey = 'id' | 'instanceId' | 'serverId' | 'targetId' | 'orderedIds' | 'instance.id'`
  - `type ChannelRule = Permission | null | { permission?: Permission; anyOf?: Permission[]; instance?: InstanceKey }`
  - `CHANNEL_PERMISSIONS: Record<string, ChannelRule>`
  - `permissionForChannel(channel): Permission | null | undefined` (first of `permission` or `anyOf[0]` for the error text)
  - `instanceKeyForChannel(channel: string): InstanceKey | undefined`
  - `isChannelAllowed(channel, permissions, isAdmin)` honours `anyOf`.
  - `ACCOUNT_CHANNEL_PERMISSIONS: Permission[]` = `users.manage` plus the six `accounts.*`.

- [ ] **Step 1: Write the failing tests**:

```ts
it('allows an anyOf channel with any one of its permissions', () => {
  expect(isChannelAllowed('get-users', ['accounts.viewers.create'], false)).toBe(true);
  expect(isChannelAllowed('create-role', ['accounts.viewers.create'], false)).toBe(false);
});
it('declares the payload key for every channel that names a server', () => {
  const expected: Record<string, InstanceKey> = {
    'get-server-instance': 'id', 'start-server-instance': 'id', 'delete-server-instance': 'id', 'rcon-command': 'id',
    'export-server-config': 'id', 'open-directory': 'id', 'get-ini-file': 'instanceId', 'create-backup': 'instanceId',
    'list-ark-api-plugins': 'instanceId', 'load-whitelist': 'instanceId', 'configure-autostart': 'serverId',
    'import-server-config': 'targetId', 'reorder-server-instances': 'orderedIds', 'save-server-instance': 'instance.id',
    'assign-server-manager': 'instanceId'
  };
  for (const [channel, key] of Object.entries(expected)) expect(instanceKeyForChannel(channel)).toBe(key);
  expect(instanceKeyForChannel('get-server-instances')).toBeUndefined();
  expect(instanceKeyForChannel('set-server-operator')).toBeUndefined();
  expect(permissionForChannel('set-server-operator')).toBeUndefined();
});
it('lets save-server-instance through on create or configure', () => {
  expect(isChannelAllowed('save-server-instance', ['servers.create'], false)).toBe(true);
  expect(isChannelAllowed('save-server-instance', ['servers.configure'], false)).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**: convert the entries listed in the spec's "Declared keys" table (all channels from the handler survey: every `payload.id` channel in `server-instance-handler`, `instanceId` channels in backup/ark-api/whitelist/ini, `serverId` in automation, `targetId`, `orderedIds`), the account channels to `{ anyOf: ACCOUNT_CHANNEL_PERMISSIONS }`, `'list-pool-labels': PERMISSIONS.SERVERS_VIEW`, `'assign-server-manager': { permission: PERMISSIONS.SERVERS_CREATE, instance: 'instanceId' }`. No entry for `set-server-operator`.

- [ ] **Step 4: Run the new test, `permission-gate.test.ts`, and the type check; green.**

- [ ] **Step 5: Commit** `feat(auth): channel rules declare instance keys`

---

### Task 5: Pool scope check in the gate

**Files:**
- Modify: `electron/services/auth/permission-gate.ts`
- Test: `electron/services/auth/permission-gate.test.ts`

**Interfaces:**
- Consumes: `instanceKeyForChannel` (Task 4), `instanceVisibleTo` (Task 3), `getInstance` from `electron/utils/ark/instance.utils`.
- Produces: `authorizeChannel(channel, sender, payload?: unknown): AuthorizationResult`; `MessagingService.emit` passes the payload. Refusal text: "That server is not in your pool."

- [ ] **Step 1: Write the failing tests** (add `jest.mock('../../utils/ark/instance.utils', () => ({ getInstance: jest.fn() }))`):

```ts
it('refuses a call about a server outside the caller\'s pool', () => {
  mockGetInstance.mockReturnValue({ id: 's1', operatorUserId: 'op-2' });
  const operator = { ...account('operator', ['servers.control']), id: 'op-1' };
  expect(authorizeChannel('start-server-instance', web(operator), { id: 's1' }))
    .toEqual({ allowed: false, error: 'That server is not in your pool.' });
});
it('refuses a reorder that includes any server outside the pool', () => {
  mockGetInstance.mockImplementation(id => ({ id, operatorUserId: id === 's2' ? 'op-2' : 'op-1' }));
  const operator = { ...account('operator', ['servers.configure']), id: 'op-1' };
  expect(authorizeChannel('reorder-server-instances', web(operator), { orderedIds: ['s1', 's2'] }).allowed).toBe(false);
});
it('leaves an unknown server to the handler and skips the check for a new server', () => {
  mockGetInstance.mockReturnValue(null);
  const operator = { ...account('operator', ['servers.create']), id: 'op-1' };
  expect(authorizeChannel('start-server-instance', web(operator), { id: 'nope' }).allowed).toBe(true);
  expect(authorizeChannel('save-server-instance', web(operator), { instance: { name: 'new' } }).allowed).toBe(true);
});
it('never scopes an admin or the desktop', () => {
  mockGetInstance.mockReturnValue({ id: 's1', operatorUserId: 'op-2' });
  expect(authorizeChannel('start-server-instance', desktop, { id: 's1' }).allowed).toBe(true);
  expect(authorizeChannel('start-server-instance', web(account('admin', ALL_PERMISSIONS)), { id: 's1' }).allowed).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `private function instanceIdsFromPayload(payload: unknown, key: InstanceKey): string[]` (handles `instance.id` and `orderedIds`), and the scope step in `authorizeChannel` after the permission check. In `MessagingService.emit`, call `authorizeChannel(event, sender, payload)`.

- [ ] **Step 4: Run `permission-gate.test.ts`, `messaging.service.test.ts` (if present) and the type check; green.**

- [ ] **Step 5: Commit** `feat(auth): gate refuses calls outside the caller's pool`

---

### Task 6: Account rules in the user handler

**Files:**
- Modify: `electron/handlers/user-handler.ts`
- Test: `electron/handlers/user-handler.test.ts`

**Interfaces:**
- Consumes: `isPoolRole`, `holdsAccountPermission`, `isPoolOwnerIdentity` (Task 3); `getAllInstances` from `instance.utils` (mock in tests).
- Produces: `get-users` reply `{ success, users, roles }` with `ownerUserId` on each user; `create-user`/`update-user` accept `ownerUserId`; new `list-pool-labels` reply `{ success, operators: PoolLabel[], assignees: PoolLabel[] }` where `type PoolLabel = { id: string; username: string; displayName: string; roleName: string }` (exported from `electron/types/auth.types.ts`).

Caller kinds, in code as `function callerKind(identity): 'admin' | 'manager' | 'pool-owner' | 'none'`: admin or desktop → `admin`; holds `users.manage` → `manager`; holds any `accounts.*` → `pool-owner`.

- [ ] **Step 1: Write the failing tests** (extend the file's `accounts` fixtures with an operator `op1` holding the six `accounts.*`, a manager `m1` with `ownerUserId: 'op1'`, and a second operator `op2`; mock `getAllInstances` to return `[]` unless a test sets it):

```ts
it('shows a pool owner only their own accounts', ...)            // get-users from op1 returns [m1] and not op2
it('forces a pool owner\'s new account into their own pool', ...) // create-user from op1 with ownerUserId 'op2' → createUser called with ownerUserId 'op1'
it('refuses a pool owner creating a role they may not create', ...) // op1 without accounts.managers.create creating server-manager → error 'Your role cannot create that kind of account.'
it('refuses a pool owner creating an operator', ...)             // error 'An operator can only create a server manager, attendant or viewer.'
it('refuses deleting an operator who still owns accounts', ...)  // admin delete op1 while m1 owned → 'Move or delete the accounts in this pool first.'
it('refuses deleting an assignee who still has servers', ...)   // getAllInstances → [{ id: 's1', managerUserId: 'm1' }] → 'Reassign their servers before deleting this account.'
it('refuses moving an assigned manager to another pool', ...)   // admin update m1 ownerUserId 'op2' with s1 assigned → 'Reassign their servers before moving them to another pool.'
it('lets an admin place a pool account under an operator', ...) // create-user from admin with ownerUserId 'op1' passes through
it('lists pool labels for an admin and for an operator', ...)   // admin: every operator and assignee; op1: themselves and m1
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**: `callerKind`, `visibleUsers(identity): User[]`, the guards in the order the spec lists them, `ownerForCreate(identity, roleId, requested)`, `list-pool-labels` using `filterInstancesForUser` over `getAllInstances()` for a pool member.

- [ ] **Step 4: Run `user-handler.test.ts` and the type check; green.**

- [ ] **Step 5: Commit** `feat(auth): pool rules for account management`

---

### Task 7: Server ownership and the instance handler

**Files:**
- Create: `electron/services/auth/server-ownership.ts`
- Create: `electron/services/auth/server-ownership.test.ts`
- Modify: `electron/handlers/server-instance-handler.ts`
- Modify: `electron/services/server-instance/server-lifecycle.service.ts` (`startAllInstances(delayMs?, onlyIds?: string[])`, `stopAllInstances(onlyIds?: string[])`)
- Modify: `electron/services/auth/channel-permissions.ts` only if a channel was missed in Task 4
- Test: `electron/handlers/server-instance-handler.test.ts`, `electron/services/server-instance/server-lifecycle.service.spec.ts`

**Interfaces:**
- Produces in `server-ownership.ts`:
  - `applyServerOwnership(instance: Partial<InstanceConfig>, existing: InstanceConfig | null, identity: SenderIdentity, lookupUser: (id: string) => User | null): string | null` (returns the refusal sentence or null; mutates `instance.operatorUserId` and `instance.managerUserId`).
  - `canAssignFor(identity: SenderIdentity, existing: InstanceConfig): boolean` (admin, or the pool's operator).
  - `assigneeRefusal(managerUserId: string | null, operatorUserId: string | null, lookupUser): string | null` ("Choose an active server manager or attendant." / "That person is not in this server's pool.").
- Handler channels added: `assign-server-manager { instanceId, managerUserId }` → `{ success, instance }`; `set-server-operator { instanceId, operatorUserId }` → `{ success, instance }`; both then `sendToAll('server-instance-updated', instance)` and `serverInstanceService.broadcastInstances()` via `afterReply`.

- [ ] **Step 1: Write the failing tests** for `server-ownership.test.ts`:

```ts
it('puts an operator\'s new server in their pool', ...)                       // operatorUserId === 'op1'
it('lets an admin choose the pool of a new server and refuses a non-operator', ...) // 'Choose an active operator for this server.'
it('keeps the stored pool when a non-admin edits', ...)
it('refuses an operator editing a server in another pool', ...)              // 'That server is not in your pool.'
it('refuses an assignee from another pool', ...)
it('keeps a stale assignee id when the caller does not touch it', ...)       // existing.managerUserId 'gone', payload omits managerUserId → no refusal
it('assigns a creating server manager to themselves', ...)                   // identity role server-manager, holds servers.create → managerUserId self, operatorUserId their owner
```

  and in `server-instance-handler.test.ts`:

```ts
it('filters get-server-instances for a non-admin', ...)
it('scopes start-all and stop-all to the visible servers', ...)              // startAllInstances called with (undefined, ['s1'])
it('refuses a server manager creating without servers.create', ...)          // 'Only an admin or operator can add a server.'
it('assigns a manager and broadcasts the update', ...)
it('moves a server between pools and clears an assignee from the old pool', ...)
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** the module and the handler changes. `save-server-instance`: refuse create without `servers.create` ("Only an admin or operator can add a server.") and edit without `servers.configure` ("Your role cannot change server settings."), then `applyServerOwnership`. `import-server-from-backup`: after import, stamp the pool the same way through `instanceUtils.saveInstance`. `get-server-instances`: `filterInstancesForUser(identity.user, result.instances)` for non-admins. `start-all`/`stop-all`: pass visible ids. Lifecycle: filter `instances` by `onlyIds` when given. Add `instanceId` to the three `notification` payloads in this handler.

- [ ] **Step 4: Run the handler test, the ownership test, the lifecycle spec and the type check; green.**

- [ ] **Step 5: Commit** `feat(servers): pool ownership and assignment`

---

### Task 8: Activity and player history scoped to the pool

**Files:**
- Modify: `electron/handlers/activity-handler.ts`, `electron/handlers/player-history-handler.ts`
- Test: `electron/handlers/activity-handler.test.ts`, `electron/handlers/player-history-handler.test.ts`

**Interfaces:**
- Consumes: `identifySender`, `filterInstancesForUser`, `getAllInstances` (mock).
- Produces: same reply shapes; `get-activity` for a non-admin returns only entries whose `instanceId` is visible; `get-player-history` returns samples with invisible ids removed from `counts`.

- [ ] **Step 1: Write the failing tests**: an operator with `s1` visible and `s2` not: activity entries `[s1, s2, null]` → only `s1`; a sample `{ t, counts: { s1: 3, s2: 5 } }` → `{ s1: 3 }`; an admin gets everything unchanged.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** with one helper in `electron/services/auth/pool-access.ts`: `visibleInstanceIds(user, instances): Set<string> | null` (`null` means everything).

- [ ] **Step 4: Run both handler tests; green.**

- [ ] **Step 5: Commit** `feat(auth): activity and player history follow the pool`

---

### Task 9: Broadcast audiences

**Files:**
- Create: `electron/services/auth/pool-directory.ts`, `electron/services/auth/pool-broadcast.ts`
- Create: `electron/services/auth/pool-broadcast.test.ts`
- Modify: `electron/types/messaging.types.ts` (`broadcast-web` gains `audience?: BroadcastAudience`; export `interface BroadcastAudience { userIds: string[]; owners: boolean }`)
- Modify: `electron/services/messaging.service.ts` (`broadcastToWebClients` splits through `scopeBroadcast`; `sendToAllWebSockets(channel, data, excludeCid?, audience?)` honours the audience)
- Modify: `electron/web-server/ipc-handlers.ts` (pass `message.audience`)
- Modify: `electron/handlers/user-handler.ts` (`broadcastUsersChanged` calls `poolDirectory.invalidate()`), `electron/utils/ark/instance.utils.ts` (`saveInstance` and `deleteInstance` call `poolDirectory.invalidate()`)
- Test: `electron/web-server/ipc-handlers.test.ts`, `electron/services/messaging.service.test.ts` (child-side audience matching)

**Interfaces:**
- `pool-directory.ts`: `class PoolDirectory { invalidate(): void; snapshot(): { users: PoolUser[]; instances: Array<{ id: string } & PoolInstance>; scoped: boolean } }` where `scoped` is false when no active non-admin user exists. Loads via `userDatabaseService.listUsers()` and `getAllInstances()` (synchronous read of config files through `instance.utils`; add `getAllInstancesSync(): InstanceConfig[]` there, sharing the existing reader). Exported singleton `poolDirectory`. Load errors log once and yield `scoped: true` with empty users (so only admins and owners receive).
- `pool-broadcast.ts`: `scopeBroadcast(channel: string, data: unknown, directory = poolDirectory): Array<{ data: unknown; audience?: BroadcastAudience }>`; `SCOPED_CHANNELS` per the spec table; admin user ids always included in `userIds`; `owners: true` always.

- [ ] **Step 1: Write the failing tests** (`pool-broadcast.test.ts` with a fake directory):

```ts
it('sends everything unscoped when no non-admin account exists', ...)
it('splits server-instances into one message per visible set, plus the full list for admins', ...)
  // users: admin a1, operator op1 (s1), viewer v1 under op1, manager m1 assigned s2 in admin pool
  // expect messages: full list → { userIds: ['a1'], owners: true }; [s1] → ['op1','v1']; [s2] → ['m1']
it('sends an operator with no visible servers an empty list', ...)
it('addresses an instanceId payload to the users who can see it plus admins', ...)
it('leaves unknown channels and payloads without instanceId unscoped', ...)
```

  and in `ipc-handlers.test.ts` / messaging tests: with an audience `{ userIds: ['u1'], owners: true }`, a socket with `_user.id 'u1'` receives, `_user.id 'u2'` does not, `_user null` receives, `_user.id 'legacy-admin'` receives.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** the directory, the scoping, the audience plumbing, the invalidation hooks, and pass `audience` through `broadcast-web`.

- [ ] **Step 4: Run all electron tests and the type check; green.**

- [ ] **Step 5: Commit** `feat(auth): broadcasts carry a pool audience`

---

### Task 10: Frontend models, auth service calls and the pool directory

**Files:**
- Modify: `src/app/core/services/auth.service.ts`
- Create: `src/app/core/services/pool-directory.service.ts`, `src/app/core/services/pool-directory.service.spec.ts`
- Test: `src/app/core/services/auth.service.spec.ts` (if present; otherwise rely on the directory spec)

**Interfaces:**
- `AuthService`: `listPoolLabels(): Promise<{ operators: PoolLabel[]; assignees: PoolLabel[] }>`, `assignServerManager(instanceId: string, managerUserId: string | null): Promise<SaveResult<ServerInstance>>`, `setServerOperator(instanceId: string, operatorUserId: string | null): Promise<SaveResult<ServerInstance>>`; `createUser`/`updateUser` accept `ownerUserId?: string | null`. `PoolLabel` exported from `auth.model.ts`.
- `PoolDirectoryService` (providedIn root): `labels$: Observable<void>` change signal, `operatorLabel(server: Pick<ServerInstance,'operatorUserId'> | null | undefined): string` ("Admin" when null), `assigneeLabel(server): string` ("Not assigned" when null), `operators: PoolLabel[]`, `assignees: PoolLabel[]`, `reload(): Promise<void>`. Reloads on `auth.identity$`, on `users-changed`, and on `server-instances` messages.

- [ ] **Step 1: Write the failing spec** for the directory: labels resolve to `displayName (username)` when they differ and to the username otherwise; unknown ids fall back to "Operator" / "Assigned"; `users-changed` triggers a reload.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** both.

- [ ] **Step 4: Run the spec; green.**

- [ ] **Step 5: Commit** `feat(ui): pool labels and ownership calls`

---

### Task 11: Users page with pools

**Files:**
- Modify: `src/app/pages/settings/users/users-settings.component.ts`, `.html`
- Test: `src/app/pages/settings/users/users-settings.component.spec.ts`

**Interfaces:**
- Consumes: `auth.can`, `auth.identity`, `accountPermissionFor` (Task 1), `ownerUserId` on create and update (Task 10).
- Produces: `form.ownerUserId: string`, `get isAdmin`, `get showOwnerField` (admin and pool role), `get operators: User[]`, `get canAddUser`, `canEditAccount(user): boolean`, `canDeleteAccount(user): boolean`, `poolLabel(user): string` ("Admin", "Operators", "Admin pool", or the owner's display name), `roleChoices(editing: User | null): DropdownOption<string>[]`.

- [ ] **Step 1: Write the failing specs**: as admin the Pool column shows "Admin pool" for an unowned viewer and the operator's name for an owned one; as a pool owner (identity with only `accounts.viewers.create`) the role dropdown offers only Viewer, the delete button for a viewer is hidden (no delete permission) and edit is shown; the owner dropdown appears for an admin editing a viewer and not for an operator role; `saveUser` sends `ownerUserId` only when the caller is admin.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**, keeping the existing derived-once pattern (`roleOptions` rebuilt in `reload`, `openCreateUser`, `openEditUser`, never in a getter used by `*ngFor`).

- [ ] **Step 4: Run the spec; green.**

- [ ] **Step 5: Commit** `feat(ui): users page shows and edits pools`

---

### Task 12: Ownership block in the general tab

**Files:**
- Modify: `src/app/components/server-settings/tabs/general-tab/general-tab.component.ts`, `.html`
- Modify: `src/app/components/server-settings/server-settings.component.html` (pass nothing new; the tab injects `AuthService` and `PoolDirectoryService`)
- Test: `src/app/components/server-settings/tabs/general-tab/general-tab.component.spec.ts`

**Interfaces:**
- Produces in the tab: `get canChooseOperator` (admin), `get canChooseAssignee` (admin, or operator whose id equals `serverInstance.operatorUserId`), `operatorOptions: DropdownOption<string>[]` (first entry `''` labelled "Admin pool"), `assigneeOptions` (first entry `''` labelled "Not assigned", then assignees whose `ownerUserId` equals the server's pool), `onOperatorChange(value: string)`, `onAssigneeChange(value: string)` calling the two `AuthService` methods and showing the result through `NotificationService`.

- [ ] **Step 1: Write the failing specs**: with an admin identity both dropdowns render; with an operator identity for a server in their pool only the assignee dropdown renders; choosing an assignee calls `assignServerManager(server.id, 'm1')`; for a viewer identity only the two labels render.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** Provide `AuthService`, `PoolDirectoryService` and `NotificationService` stubs in the spec's `TestBed`.

- [ ] **Step 4: Run the spec; green.**

- [ ] **Step 5: Commit** `feat(ui): server ownership in the general tab`

---

### Task 13: Server card labels and menu gating

**Files:**
- Modify: `src/app/components/server-card/server-card.component.ts`, `.html`
- Modify: `src/app/pages/dashboard/dashboard.component.ts`, `.html`
- Modify: `src/styles/_dashboard.scss` (operator, assignee and join address over the map artwork)
- Test: `src/app/components/server-card/server-card.component.spec.ts`, `src/app/pages/dashboard/dashboard.component.spec.ts`

**Interfaces:**
- Card inputs: `@Input() operatorLabel = ''`, `@Input() assigneeLabel = ''`, `@Input() canConfigure = true`, `@Input() canBackups = true`. The dashboard binds them from `PoolDirectoryService` and `auth.can(...)`.

- [ ] **Step 1: Write the failing specs**: the card renders the operator, assignee and join address on the artwork; with `canConfigure` false the Configure menu item is absent; the dashboard passes `canConfigure` false for an identity without `servers.configure`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** The dashboard spec's `AuthService` stub gains `can: () => boolean` and `identity$`.

- [ ] **Step 4: Run both specs; green.**

- [ ] **Step 5: Commit** `feat(ui): pool labels on the server card`

---

### Task 14: Dashboard, sidebar and server page gating

**Files:**
- Modify: `src/app/pages/dashboard/dashboard.component.ts`, `.html` (Add Server needs `servers.create`; delete needs `servers.delete`)
- Modify: `src/app/components/sidebar/sidebar.component.ts`, `.html` (add needs `servers.create`; rename needs `servers.configure`; delete needs `servers.delete`)
- Modify: `src/app/pages/server/server.component.ts`, `.html` (`get canUseRcon` gates `app-rcon-control`)
- Test: the three components' specs

**Interfaces:**
- Each component exposes `get canCreateServer`, `get canDeleteServer`, `get canRenameServer`, `get canUseRcon` as applicable, all reading `auth.can(PERMISSIONS.X)`.

- [ ] **Step 1: Write the failing specs**: with a stub identity lacking `servers.create` the Add Server buttons are absent on the dashboard and in the sidebar; lacking `rcon.use` the server page has no `app-rcon-control`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the three specs; green.**

- [ ] **Step 5: Commit** `feat(ui): hide server actions the role lacks`

---

### Task 15: Whole-branch verification

- [ ] **Step 1:** `npx tsc -p tsconfig.electron.json --noEmit` → no output.
- [ ] **Step 2:** `npx jest --config jest.electron.config.js` → all suites pass.
- [ ] **Step 3:** `npx ng test --watch=false --browsers=ChromeHeadless` → `Executed N of N SUCCESS`.
- [ ] **Step 4:** `git diff --stat main...HEAD -- src electron` → no file shows a whole-file rewrite from a line-ending flip (new files are CRLF).
- [ ] **Step 5:** Manual pass in the web UI with two operators and one pool account each: each operator's dashboard shows only their servers; the pool account sees only its assigned server; the admin sees all; log lines for one pool's server never appear in the other operator's console.
