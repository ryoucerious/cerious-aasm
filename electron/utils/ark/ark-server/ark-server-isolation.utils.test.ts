// This suite exercises real junction/symlink behaviour, so it opts out of the
// global path / fs / fs-extra mocks installed by test/setup.ts.
jest.mock('path', () => jest.requireActual('path'));
jest.mock('fs', () => jest.requireActual('fs'));
jest.mock('fs-extra', () => jest.requireActual('fs-extra'));

import * as os from 'os';
import * as path from 'path';
import {
  linkSharedWin64Subdirs,
  linkSharedShooterGameSubdirs,
  INSTANCE_OWNED_WIN64_SUBDIRS,
  INSTANCE_OWNED_SHOOTERGAME_SUBDIRS
} from './ark-server-isolation.utils';

const fs: typeof import('fs') = jest.requireActual('fs');

describe('linkSharedWin64Subdirs', () => {
  let tmpDir: string;
  let sourceWin64: string;
  let destWin64: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-isolation-'));
    sourceWin64 = path.join(tmpDir, 'shared', 'Win64');
    destWin64 = path.join(tmpDir, 'instance', 'Win64');
    fs.mkdirSync(sourceWin64, { recursive: true });
    fs.mkdirSync(destWin64, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedSource(dir: string, fileName = 'file.dll') {
    fs.mkdirSync(path.join(sourceWin64, dir), { recursive: true });
    fs.writeFileSync(path.join(sourceWin64, dir, fileName), 'x');
  }

  it('makes the EOS SDK reachable from the instance Win64 folder', async () => {
    seedSource('RedpointEOS', 'EOSSDK-Win64-Shipping.dll');

    const linked = await linkSharedWin64Subdirs(sourceWin64, destWin64);

    expect(linked).toContain('RedpointEOS');
    expect(fs.existsSync(path.join(destWin64, 'RedpointEOS', 'EOSSDK-Win64-Shipping.dll'))).toBe(true);
  });

  it('links every game subfolder the shared install provides', async () => {
    seedSource('RedpointEOS');
    seedSource('BattlEye');
    seedSource('D3D12');
    seedSource('DML');

    const linked = await linkSharedWin64Subdirs(sourceWin64, destWin64);

    expect(linked.sort()).toEqual(['BattlEye', 'D3D12', 'DML', 'RedpointEOS']);
  });

  it('leaves instance-owned folders alone', async () => {
    INSTANCE_OWNED_WIN64_SUBDIRS.forEach(name => seedSource(name));

    const linked = await linkSharedWin64Subdirs(sourceWin64, destWin64);

    expect(linked).toEqual([]);
    INSTANCE_OWNED_WIN64_SUBDIRS.forEach(name => {
      expect(fs.existsSync(path.join(destWin64, name))).toBe(false);
    });
  });

  it('ignores loose files in the shared folder', async () => {
    fs.writeFileSync(path.join(sourceWin64, 'ArkAscendedServer.exe'), 'x');

    const linked = await linkSharedWin64Subdirs(sourceWin64, destWin64);

    expect(linked).toEqual([]);
  });

  it('preserves a real folder the instance already owns', async () => {
    seedSource('RedpointEOS', 'EOSSDK-Win64-Shipping.dll');
    fs.mkdirSync(path.join(destWin64, 'RedpointEOS'), { recursive: true });
    fs.writeFileSync(path.join(destWin64, 'RedpointEOS', 'custom.dll'), 'y');

    const linked = await linkSharedWin64Subdirs(sourceWin64, destWin64);

    expect(linked).toEqual([]);
    expect(fs.existsSync(path.join(destWin64, 'RedpointEOS', 'custom.dll'))).toBe(true);
  });

  it('repairs a link left dangling by a moved shared install', async () => {
    seedSource('RedpointEOS', 'EOSSDK-Win64-Shipping.dll');
    const stale = path.join(tmpDir, 'gone');
    fs.mkdirSync(stale);
    fs.symlinkSync(stale, path.join(destWin64, 'RedpointEOS'), 'junction');
    fs.rmSync(stale, { recursive: true, force: true });

    const linked = await linkSharedWin64Subdirs(sourceWin64, destWin64);

    expect(linked).toContain('RedpointEOS');
    expect(fs.existsSync(path.join(destWin64, 'RedpointEOS', 'EOSSDK-Win64-Shipping.dll'))).toBe(true);
  });

  it('is a no-op when the shared install is missing', async () => {
    await expect(linkSharedWin64Subdirs(path.join(tmpDir, 'nope'), destWin64)).resolves.toEqual([]);
  });

  it('runs clean on a second pass', async () => {
    seedSource('RedpointEOS');

    await linkSharedWin64Subdirs(sourceWin64, destWin64);
    const second = await linkSharedWin64Subdirs(sourceWin64, destWin64);

    expect(second).toEqual([]);
  });
});

describe('linkSharedShooterGameSubdirs', () => {
  let tmpDir: string;
  let sourceGame: string;
  let destGame: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-isolation-game-'));
    sourceGame = path.join(tmpDir, 'shared', 'ShooterGame');
    destGame = path.join(tmpDir, 'instance', 'ShooterGame');
    fs.mkdirSync(sourceGame, { recursive: true });
    fs.mkdirSync(destGame, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedSource(dir: string, fileName = 'file.dll') {
    fs.mkdirSync(path.join(sourceGame, dir), { recursive: true });
    fs.writeFileSync(path.join(sourceGame, dir, fileName), 'x');
  }

  it('makes the bundled UE plugins reachable from the instance', async () => {
    fs.mkdirSync(
      path.join(sourceGame, 'Plugins', 'DiscordPartnerSDK', 'Binaries', 'ThirdParty', 'DiscordPartnerSDKLibrary', 'Win64', 'Release'),
      { recursive: true }
    );
    fs.writeFileSync(
      path.join(sourceGame, 'Plugins', 'DiscordPartnerSDK', 'Binaries', 'ThirdParty', 'DiscordPartnerSDKLibrary', 'Win64', 'Release', 'discord_partner_sdk.dll'),
      'x'
    );

    const linked = await linkSharedShooterGameSubdirs(sourceGame, destGame);

    expect(linked).toContain('Plugins');
    expect(fs.existsSync(
      path.join(destGame, 'Plugins', 'DiscordPartnerSDK', 'Binaries', 'ThirdParty', 'DiscordPartnerSDKLibrary', 'Win64', 'Release', 'discord_partner_sdk.dll')
    )).toBe(true);
  });

  it('never links folders the instance must own', async () => {
    INSTANCE_OWNED_SHOOTERGAME_SUBDIRS.forEach(name => seedSource(name));
    seedSource('Plugins');

    const linked = await linkSharedShooterGameSubdirs(sourceGame, destGame);

    expect(linked).toEqual(['Plugins']);
    INSTANCE_OWNED_SHOOTERGAME_SUBDIRS.forEach(name => {
      expect(fs.existsSync(path.join(destGame, name))).toBe(false);
    });
  });

  it('creates the instance folder when it does not exist yet', async () => {
    seedSource('Plugins');
    fs.rmSync(destGame, { recursive: true, force: true });

    const linked = await linkSharedShooterGameSubdirs(sourceGame, destGame);

    expect(linked).toEqual(['Plugins']);
    expect(fs.existsSync(path.join(destGame, 'Plugins', 'file.dll'))).toBe(true);
  });
});
