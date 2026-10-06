import {
  ACCOUNT_CHANNEL_PERMISSIONS,
  CHANNEL_PERMISSIONS,
  InstanceKey,
  instanceKeyForChannel,
  isChannelAllowed,
  permissionForChannel
} from './channel-permissions';

describe('channel-permissions', () => {
  it('keeps plain entries working as before', () => {
    expect(permissionForChannel('start-server-instance')).toBe('servers.control');
    expect(permissionForChannel('get-current-user')).toBeNull();
    expect(permissionForChannel('no-such-channel')).toBeUndefined();
    expect(isChannelAllowed('start-server-instance', ['servers.control'], false)).toBe(true);
    expect(isChannelAllowed('start-server-instance', ['servers.view'], false)).toBe(false);
  });

  it('allows an anyOf channel with any one of its permissions', () => {
    expect(isChannelAllowed('get-users', ['accounts.viewers.create'], false)).toBe(true);
    expect(isChannelAllowed('get-users', ['users.manage'], false)).toBe(true);
    expect(isChannelAllowed('get-users', ['servers.view'], false)).toBe(false);
    expect(isChannelAllowed('create-role', ['accounts.viewers.create'], false)).toBe(false);
    expect(ACCOUNT_CHANNEL_PERMISSIONS).toEqual([
      'users.manage',
      'accounts.managers.create', 'accounts.managers.delete',
      'accounts.attendants.create', 'accounts.attendants.delete',
      'accounts.viewers.create', 'accounts.viewers.delete'
    ]);
  });

  it('names a permission for the refusal text of an object rule', () => {
    expect(permissionForChannel('get-users')).toBe('users.manage');
    expect(permissionForChannel('assign-server-manager')).toBe('servers.create');
  });

  it('lets save-server-instance through on create or configure', () => {
    expect(isChannelAllowed('save-server-instance', ['servers.create'], false)).toBe(true);
    expect(isChannelAllowed('save-server-instance', ['servers.configure'], false)).toBe(true);
    expect(isChannelAllowed('save-server-instance', ['servers.view'], false)).toBe(false);
  });

  it('declares the payload key for every channel that names a server', () => {
    const expected: Record<string, InstanceKey> = {
      'get-server-instance': 'id', 'get-server-instance-state': 'id', 'get-server-instance-logs': 'id',
      'get-server-instance-players': 'id', 'get-rcon-status': 'id', 'start-server-instance': 'id',
      'stop-server-instance': 'id', 'force-stop-server-instance': 'id', 'connect-rcon': 'id', 'disconnect-rcon': 'id',
      'rcon-command': 'id', 'get-online-players': 'id', 'delete-server-instance': 'id', 'export-server-config': 'id',
      'open-directory': 'id',
      'get-ini-file': 'instanceId', 'save-ini-file': 'instanceId',
      'create-backup': 'instanceId', 'get-backup-list': 'instanceId', 'restore-backup': 'instanceId',
      'delete-backup': 'instanceId', 'get-backup-settings': 'instanceId', 'save-backup-settings': 'instanceId',
      'start-backup-scheduler': 'instanceId', 'stop-backup-scheduler': 'instanceId', 'get-scheduler-status': 'instanceId',
      'download-backup': 'instanceId',
      'get-asaapi-status': 'instanceId', 'list-ark-api-plugins': 'instanceId', 'remove-ark-api-plugin': 'instanceId',
      'download-asaapi': 'instanceId', 'install-plugin-from-zip': 'instanceId', 'install-plugin-from-url': 'instanceId',
      'load-whitelist': 'instanceId', 'add-to-whitelist': 'instanceId', 'remove-from-whitelist': 'instanceId',
      'clear-whitelist': 'instanceId',
      'configure-autostart': 'serverId', 'configure-crash-detection': 'serverId', 'configure-discord-webhook': 'serverId',
      'configure-broadcasts': 'serverId', 'configure-scheduled-restart': 'serverId', 'get-automation-status': 'serverId',
      'import-server-config': 'targetId',
      'reorder-server-instances': 'orderedIds',
      'save-server-instance': 'instance.id',
      'assign-server-manager': 'instanceId'
    };
    for (const [channel, key] of Object.entries(expected)) {
      expect([channel, instanceKeyForChannel(channel)]).toEqual([channel, key]);
    }
    expect(instanceKeyForChannel('get-server-instances')).toBeUndefined();
    expect(instanceKeyForChannel('get-asaapi-latest')).toBeUndefined();
    expect(instanceKeyForChannel('auto-start-on-app-launch')).toBeUndefined();
  });

  it('lets whoever manages nodes rename a member', () => {
    expect(isChannelAllowed('rename-mesh-node', ['nodes.manage'], false)).toBe(true);
    expect(isChannelAllowed('rename-mesh-node', ['nodes.view'], false)).toBe(false);
    expect(isChannelAllowed('set-mesh-node-address', ['nodes.manage'], false)).toBe(true);
    expect(isChannelAllowed('set-mesh-node-address', ['nodes.view'], false)).toBe(false);
  });

  it('leaves set-server-operator to admins and opens list-pool-labels to anyone who can view servers', () => {
    expect(permissionForChannel('set-server-operator')).toBeUndefined();
    expect(instanceKeyForChannel('set-server-operator')).toBeUndefined();
    expect(CHANNEL_PERMISSIONS['list-pool-labels']).toBe('servers.view');
  });
});
