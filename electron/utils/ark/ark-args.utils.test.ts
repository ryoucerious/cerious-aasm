import { buildArkServerArgs, getArkMapName, getArkLaunchParameters } from './ark-args.utils';

describe('ark-args.utils', () => {
  describe('buildArkServerArgs', () => {
    it('should return default args for empty config', () => {
      const args = buildArkServerArgs({});
      expect(args).toContain('-ServerPlatform=PC');
    });

    it('should include session name with spaces unencoded', () => {
      const args = buildArkServerArgs({ sessionName: 'My Test Server' });
      const mainArg = args[0];
      expect(mainArg).toContain('SessionName=My Test Server');
    });

    it('should include session name with special characters unencoded', () => {
      const args = buildArkServerArgs({ sessionName: 'Server Name' });
      const mainArg = args[0];
      expect(mainArg).toContain('SessionName=Server Name');
    });

    it('should include server password unencoded', () => {
      const args = buildArkServerArgs({ serverPassword: 'pass word' });
      const mainArg = args[0];
      expect(mainArg).toContain('ServerPassword=pass word');
    });

    it('should include admin password unencoded', () => {
      const args = buildArkServerArgs({ serverAdminPassword: 'adminpass' });
      const mainArg = args[0];
      expect(mainArg).toContain('ServerAdminPassword=adminpass');
    });

    it('should include MaxPlayers on command line', () => {
      const args = buildArkServerArgs({ maxPlayers: 20 });
      const mainArg = args[0];
      expect(mainArg).toContain('MaxPlayers=20');
    });

    it('should not include MaxPlayers when not set', () => {
      const args = buildArkServerArgs({});
      const mainArg = args[0];
      expect(mainArg).not.toContain('MaxPlayers');
    });

    it('should include ServerPVE when bPvE is true', () => {
      const args = buildArkServerArgs({ bPvE: true });
      const mainArg = args[0];
      expect(mainArg).toContain('ServerPVE');
    });

    it('should include ServerPVE when serverPVE is "true"', () => {
      const args = buildArkServerArgs({ serverPVE: 'true' });
      const mainArg = args[0];
      expect(mainArg).toContain('ServerPVE');
    });

    it('should not include ServerPVE when PvE is false', () => {
      const args = buildArkServerArgs({ bPvE: false, serverPVE: false });
      const mainArg = args[0];
      expect(mainArg).not.toContain('ServerPVE');
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

    it('should add -NOSTEAM when disableSteamSubsystem is true', () => {
      const args = buildArkServerArgs({ disableSteamSubsystem: true });
      expect(args).toContain('-NOSTEAM');
    });

    it('should not add -NOSTEAM by default', () => {
      const args = buildArkServerArgs({});
      expect(args).not.toContain('-NOSTEAM');
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
