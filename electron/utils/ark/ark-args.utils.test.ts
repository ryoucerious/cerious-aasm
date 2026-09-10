import { buildArkServerArgs, getArkMapName, getArkLaunchParameters } from './ark-args.utils';

describe('ark-args.utils', () => {
  describe('buildArkServerArgs', () => {
    it('should return default args for empty config', () => {
      const args = buildArkServerArgs({});
      expect(args).toContain('-ServerPlatform=PC');
    });

    // SessionName is delivered through GameUserSettings.ini [SessionSettings] (see the
    // sessionName mapping in ark-config.service.ts), NOT the launch URL. UE splits the
    // command line on spaces before parsing `?` params, so a name like "My Server" used
    // to truncate everything after it — dropping Port, QueryPort and the admin password.
    it('should not put SessionName on the command line', () => {
      const args = buildArkServerArgs({ sessionName: 'My Test Server' });
      expect(args.join(' ')).not.toContain('SessionName');
    });

    it('should keep critical params intact when the session name contains spaces', () => {
      const args = buildArkServerArgs({
        sessionName: 'My Server With Spaces',
        gamePort: 7777,
        serverAdminPassword: 'adminpass',
        queryPort: 27015
      });
      const mainArg = args[0];
      // No space anywhere in the query string means nothing downstream can be truncated
      expect(mainArg).not.toContain(' ');
      expect(mainArg).toContain('Port=7777');
      expect(mainArg).toContain('QueryPort=27015');
      expect(mainArg).toContain('ServerAdminPassword=adminpass');
    });

    // ARK does not URL-decode command-line values, so an encoded password would reach the
    // server encoded and no player typing the real one could join.
    it('should include server password unencoded', () => {
      const args = buildArkServerArgs({ serverPassword: 'pass word' });
      const mainArg = args[0];
      expect(mainArg).toContain('ServerPassword=pass word');
    });

    it('should not percent-encode special characters in the server password', () => {
      const args = buildArkServerArgs({ serverPassword: 'p@ss!word#1' });
      const mainArg = args[0];
      expect(mainArg).toContain('ServerPassword=p@ss!word#1');
      expect(mainArg).not.toContain('%');
    });

    it('should include admin password unencoded', () => {
      const args = buildArkServerArgs({ serverAdminPassword: 'adminpass' });
      const mainArg = args[0];
      expect(mainArg).toContain('ServerAdminPassword=adminpass');
    });

    // ARK:SA honours -WinLiveMaxPlayers, not the [/script/engine.gamesession] INI key
    // and not a ?MaxPlayers= URL param.
    it('should pass the player cap as -WinLiveMaxPlayers', () => {
      const args = buildArkServerArgs({ maxPlayers: 20 });
      expect(args).toContain('-WinLiveMaxPlayers=20');
    });

    it('should let winLiveMaxPlayers override maxPlayers', () => {
      const args = buildArkServerArgs({ maxPlayers: 20, winLiveMaxPlayers: 70 });
      expect(args).toContain('-WinLiveMaxPlayers=70');
    });

    it('should not include MaxPlayers when not set', () => {
      const args = buildArkServerArgs({});
      expect(args.join(' ')).not.toContain('MaxPlayers');
    });

    it('should include ServerPVE=True when bPvE is true', () => {
      const args = buildArkServerArgs({ bPvE: true });
      const mainArg = args[0];
      expect(mainArg).toContain('ServerPVE=True');
    });

    it('should include ServerPVE=True when serverPVE is "true"', () => {
      const args = buildArkServerArgs({ serverPVE: 'true' });
      const mainArg = args[0];
      expect(mainArg).toContain('ServerPVE=True');
    });

    it('should not include ServerPVE when PvE is false', () => {
      const args = buildArkServerArgs({ bPvE: false, serverPVE: false });
      const mainArg = args[0];
      expect(mainArg).not.toContain('ServerPVE');
    });

    // Issue: users tunnelling traffic through ZeroTier/WireGuard must bind the tunnel
    // interface, but MultiHome was hardcoded to 0.0.0.0 so the server advertised the
    // host's own address and was unreachable.
    describe('MultiHome', () => {
      it('should default to 0.0.0.0 when multiHome is not configured', () => {
        const args = buildArkServerArgs({});
        expect(args[0]).toContain('MultiHome=0.0.0.0');
      });

      it('should use a configured multiHome address', () => {
        const args = buildArkServerArgs({ multiHome: '10.147.20.5' });
        expect(args[0]).toContain('MultiHome=10.147.20.5');
        expect(args[0]).not.toContain('MultiHome=0.0.0.0');
      });

      it('should trim surrounding whitespace from multiHome', () => {
        const args = buildArkServerArgs({ multiHome: '  192.168.1.50  ' });
        expect(args[0]).toContain('MultiHome=192.168.1.50');
      });

      it('should fall back to 0.0.0.0 when multiHome is empty', () => {
        const args = buildArkServerArgs({ multiHome: '   ' });
        expect(args[0]).toContain('MultiHome=0.0.0.0');
      });

      // The value is interpolated into the `?`-delimited launch URL, so a malformed
      // entry must never reach the command line.
      it('should fall back to 0.0.0.0 for a malformed multiHome', () => {
        for (const bad of ['not-an-ip', '999.1.1.1', '10.0.0', '10.0.0.1?Foo=bar', '10.0.0.1 extra']) {
          const args = buildArkServerArgs({ multiHome: bad });
          expect(args[0]).toContain('MultiHome=0.0.0.0');
          expect(args[0]).not.toContain(bad);
        }
      });

      it('should emit exactly one MultiHome param', () => {
        const args = buildArkServerArgs({ multiHome: '10.147.20.5' });
        expect(args[0].split('MultiHome=').length - 1).toBe(1);
      });
    });

    it('should not include QueryPort when set to 0', () => {
      const args = buildArkServerArgs({ queryPort: 0 });
      const mainArg = args[0];
      expect(mainArg).not.toContain('QueryPort');
    });

    it('should include QueryPort when set to a valid port', () => {
      const args = buildArkServerArgs({ queryPort: 27015 });
      const mainArg = args[0];
      expect(mainArg).toContain('QueryPort=27015');
    });

    // The Wine/Proton compatibility flags are Linux-only and are what carries -NOSTEAM.
    // The old per-server `disableSteamSubsystem` toggle no longer drives anything.
    describe('Wine/Proton compatibility flags', () => {
      const { getPlatform } = require('../platform.utils');

      afterEach(() => jest.restoreAllMocks());

      it('should add the compat flags on Linux by default', () => {
        jest.spyOn(require('../platform.utils'), 'getPlatform').mockReturnValue('linux');
        const args = buildArkServerArgs({});
        expect(args).toContain('-NOSTEAM');
        expect(args).toContain('-NoHangDetection');
        expect(args).toContain('-norhithread');
      });

      it('should omit the compat flags when disableWineCompatFlags is set', () => {
        jest.spyOn(require('../platform.utils'), 'getPlatform').mockReturnValue('linux');
        const args = buildArkServerArgs({ disableWineCompatFlags: true });
        expect(args).not.toContain('-NOSTEAM');
        expect(args).not.toContain('-NoHangDetection');
      });

      it('should never add the compat flags on Windows', () => {
        jest.spyOn(require('../platform.utils'), 'getPlatform').mockReturnValue('windows');
        const args = buildArkServerArgs({});
        expect(args).not.toContain('-NOSTEAM');
        expect(args).not.toContain('-norhithread');
        expect(getPlatform).toBeDefined();
      });
    });

    it('should use serverPlatform if set', () => {
      const args = buildArkServerArgs({ serverPlatform: 'XSX' });
      expect(args).toContain('-ServerPlatform=XSX');
    });

    it('should convert crossplay array to platform string', () => {
      const args = buildArkServerArgs({ crossplay: ['Steam (PC)', 'Xbox (XSX)'] });
      expect(args).toContain('-ServerPlatform=PC+XSX');
    });

    it('should add cluster flags if set', () => {
      const config = {
        noTransferFromFiltering: true,
        preventDownloadSurvivors: true,
        preventDownloadItems: true,
        preventDownloadDinos: true,
        preventUploadSurvivors: true,
        preventUploadItems: true,
        preventUploadDinos: true
      };
      const args = buildArkServerArgs(config);
      expect(args).toContain('-NoTransferFromFiltering');
      expect(args).toContain('-PreventDownloadSurvivors');
      expect(args).toContain('-PreventDownloadItems');
      expect(args).toContain('-PreventDownloadDinos');
      expect(args).toContain('-PreventUploadSurvivors');
      expect(args).toContain('-PreventUploadItems');
      expect(args).toContain('-PreventUploadDinos');
    });
  });

  describe('getArkMapName', () => {
    it('should return mapName from config', () => {
      expect(getArkMapName({ mapName: 'Valguero_P' })).toBe('Valguero_P');
    });
    it('should return default map if not set', () => {
      expect(getArkMapName({})).toBe('TheIsland_WP');
    });
  });

  describe('getArkLaunchParameters', () => {
    it('should handle enabledMods array', () => {
      const config = { mods: [], enabledMods: ['123', '456'] };
      const params = getArkLaunchParameters(config);
      expect(params).toContain('-mods=123,456');
    });
    it('should handle legacy mods array with objects', () => {
      const config = { mods: [{ id: '789', enabled: true }, { id: '101', enabled: false }] };
      const params = getArkLaunchParameters(config);
      expect(params).toContain('-mods=789');
    });
    it('should handle mods array with string IDs', () => {
      const config = { mods: ['202', '303'] };
      const params = getArkLaunchParameters(config);
      expect(params).toContain('-mods=202,303');
    });
    it('should add additional launchParameters from config', () => {
      const config = { launchParameters: '-foo -bar' };
      const params = getArkLaunchParameters(config);
      expect(params).toContain('-foo');
      expect(params).toContain('-bar');
    });
    it('should return empty array if no mods or launchParameters', () => {
      expect(getArkLaunchParameters({})).toEqual([]);
    });
  });
});
