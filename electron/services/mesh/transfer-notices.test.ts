import { TransferNotices, playerIdOfClusterFile } from './transfer-notices';

describe('telling a player their upload is ready', () => {
  const PLAYER = '0002a1b2c3d4e5f60718293a4b5c6d7e';
  const FILE = `clusters/Islands/${PLAYER}`;
  let now: number;
  let machines: string[];
  let enabled: boolean;
  let notify: jest.Mock;
  let notices: TransferNotices;

  const upload = (version: number, size = 100 * version, previousSize: number | null = version === 1 ? null : 100 * (version - 1)) =>
    ({ clusterId: 'c1', path: FILE, version, size, previousSize, deleted: false });

  beforeEach(() => {
    now = 1_000;
    machines = ['B', 'C'];
    enabled = true;
    notify = jest.fn(async () => undefined);
    notices = new TransferNotices({
      machinesFor: async () => machines,
      enabled: async () => enabled,
      notify,
      timeoutMs: 120_000,
      now: () => now
    });
  });

  it('tells the player once every other machine with the cluster\'s servers has their upload', async () => {
    await notices.recorded(upload(1));

    notices.placed('B', { clusterId: 'c1', path: FILE, version: 1 });
    expect(notify).not.toHaveBeenCalled();
    notices.placed('C', { clusterId: 'c1', path: FILE, version: 1 });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('c1', PLAYER);
  });

  // The confirmation can arrive while the machines are still being looked up.
  it('counts a machine that already had that version, or a newer one', async () => {
    notices.placed('B', { clusterId: 'c1', path: FILE, version: 1 });
    notices.placed('C', { clusterId: 'c1', path: FILE, version: 1 });

    await notices.recorded(upload(1));

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('sends one message for uploads that come faster than they sync, once the last is everywhere', async () => {
    await notices.recorded(upload(1));
    await notices.recorded(upload(2));
    notices.placed('B', { clusterId: 'c1', path: FILE, version: 1 });
    notices.placed('C', { clusterId: 'c1', path: FILE, version: 1 });
    expect(notify).not.toHaveBeenCalled();

    notices.placed('B', { clusterId: 'c1', path: FILE, version: 2 });
    notices.placed('C', { clusterId: 'c1', path: FILE, version: 2 });

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a file that shrank', { ...upload(2), size: 50, previousSize: 200 }],
    ['a file that went', { ...upload(2), size: 0, previousSize: 200, deleted: true }]
  ])('says nothing of a download, %s, and drops a notice still waiting', async (_label, download) => {
    await notices.recorded(upload(1));

    await notices.recorded(download);
    notices.placed('B', { clusterId: 'c1', path: FILE, version: 2 });
    notices.placed('C', { clusterId: 'c1', path: FILE, version: 2 });

    expect(notify).not.toHaveBeenCalled();
  });

  // ARK reads the folder the player uploaded into at once.
  it('says nothing when no other machine hosts a server in the cluster', async () => {
    machines = [];

    await notices.recorded(upload(1));

    expect(notify).not.toHaveBeenCalled();
  });

  it('says nothing of a file not named after a player', async () => {
    await notices.recorded({ ...upload(1), path: 'clusters/Islands/notes.txt' });
    notices.placed('B', { clusterId: 'c1', path: 'clusters/Islands/notes.txt', version: 1 });
    notices.placed('C', { clusterId: 'c1', path: 'clusters/Islands/notes.txt', version: 1 });

    expect(notify).not.toHaveBeenCalled();
  });

  it('says nothing in a cluster where players are not told', async () => {
    enabled = false;

    await notices.recorded(upload(1));
    notices.placed('B', { clusterId: 'c1', path: FILE, version: 1 });
    notices.placed('C', { clusterId: 'c1', path: FILE, version: 1 });

    expect(notify).not.toHaveBeenCalled();
  });

  it('gives up on a machine that never says it has the upload, rather than tell the player too soon', async () => {
    await notices.recorded(upload(1));
    notices.placed('B', { clusterId: 'c1', path: FILE, version: 1 });

    now += 120_001;
    notices.expire();
    notices.placed('C', { clusterId: 'c1', path: FILE, version: 1 });

    expect(notify).not.toHaveBeenCalled();
  });

  it('drops the notice when another machine changes the file first', async () => {
    await notices.recorded(upload(1));

    notices.superseded({ clusterId: 'c1', path: FILE, version: 2 });
    notices.placed('B', { clusterId: 'c1', path: FILE, version: 2 });
    notices.placed('C', { clusterId: 'c1', path: FILE, version: 2 });

    expect(notify).not.toHaveBeenCalled();
  });

  describe('the player a cluster file belongs to', () => {
    it.each([
      [`clusters/Islands/${PLAYER}`, PLAYER],
      [`clusters/Islands/${PLAYER.toUpperCase()}`, PLAYER],
      [`clusters/Islands/${PLAYER}.arkprofile`, PLAYER],
      ['clusters/Islands/76561198000000000', '76561198000000000'],
      ['clusters/Islands/notes.txt', null],
      ['clusters/Islands/0002a1b2', null]
    ])('%s is %p', (rel, expected) => {
      expect(playerIdOfClusterFile(rel)).toBe(expected);
    });
  });
});
