import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getDefaultInstallDir } from '../platform.utils';
import { writeJsonAtomic } from '../fs.utils';
import {
  getInstancesBaseDir,
  getInstanceDir,
  getAllInstances,
  getInstance,
  saveInstance,
  deleteInstance,
  getInstanceSaveDir
} from './instance.utils';

jest.mock('../platform.utils');
jest.mock('../fs.utils');
jest.mock('../global-config.utils', () => ({
  loadGlobalConfig: jest.fn(() => ({ serverDataDir: '' }))
}));

const mockedFs = jest.mocked(fs);
const mockedPath = jest.mocked(path);
const mockedGetDefaultInstallDir = jest.mocked(getDefaultInstallDir);
const mockedWriteJsonAtomic = jest.mocked(writeJsonAtomic);

const mockInstallDir = '/mock/install/dir';
const mockInstancesBaseDir = '/mock/install/dir/AASMServer/ShooterGame/Saved/Servers';

const mockInstanceConfig = {
  id: 'test-instance-1',
  name: 'Test Server',
  port: 7777,
  queryPort: 27015
};

const mockInstanceConfig2 = {
  id: 'test-instance-2',
  name: 'Another Server',
  port: 7778,
  queryPort: 27016
};

describe('instance.utils', () => {
  beforeEach(() => {
    mockedFs.existsSync.mockReset();
    mockedFs.readFileSync.mockReset();
    mockedFs.readdirSync.mockReset();
    mockedGetDefaultInstallDir.mockReturnValue(mockInstallDir);
  });

  describe('validateInstanceId (indirect)', () => {
    it('should throw for invalid instance IDs in getInstance', () => {
      expect(() => getInstance('../bad-id')).toThrow('Invalid instance ID format: ../bad-id');
      const longId = 'a'.repeat(51);
      expect(() => getInstance(longId)).toThrow(`Invalid instance ID format: ${longId}`);
    });

    it('should reject invalid instance IDs in saveInstance', async () => {
      await expect(saveInstance({ id: '../bad-id', name: 'Bad' })).rejects.toThrow('Invalid instance ID format');
      await expect(saveInstance({ id: 'a'.repeat(51), name: 'Long' })).rejects.toThrow('Invalid instance ID format');
    });
  });

  describe('getInstancesBaseDir', () => {
    it('should return the correct instances base directory', () => {
      expect(getInstancesBaseDir()).toBe(mockInstancesBaseDir);
      expect(mockedGetDefaultInstallDir).toHaveBeenCalled();
    });

    it('should throw error when install directory is not available', () => {
      mockedGetDefaultInstallDir.mockReturnValue(null as unknown as string);
      expect(() => getInstancesBaseDir()).toThrow('Could not determine install directory');
    });
  });

  describe('getInstanceDir', () => {
    it('returns the instance directory under a base path containing spaces', () => {
      mockedGetDefaultInstallDir.mockReturnValue('C:/Users/A B/AppData/Roaming/Cerious AASM');

      expect(getInstanceDir('abc-123')).toBe(
        'C:/Users/A B/AppData/Roaming/Cerious AASM/AASMServer/ShooterGame/Saved/Servers/abc-123'
      );
    });

    it.each(['../x', '..', 'a/b', 'a\\b', 'C:', '', 'a'.repeat(51)])('rejects the id %p', id => {
      expect(() => getInstanceDir(id)).toThrow('Invalid instance ID format');
    });

    it('rejects a directory that resolves outside the base directory', () => {
      mockedPath.resolve.mockReturnValueOnce('/elsewhere/abc');

      expect(() => getInstanceDir('abc')).toThrow('escapes');
    });
  });

  describe('getAllInstances', () => {
    it('should return all valid instances from the directory', async () => {
      const mockDirs = ['test-instance-1', 'test-instance-2', 'invalid-dir'];
      const mockConfigPath1 = `${mockInstancesBaseDir}/test-instance-1/config.json`;
      const mockConfigPath2 = `${mockInstancesBaseDir}/test-instance-2/config.json`;

      mockedFs.existsSync.mockImplementation(p => p === mockConfigPath1 || p === mockConfigPath2);
      mockedFs.readdirSync.mockReturnValue(mockDirs as any);
      mockedFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockInstanceConfig))
        .mockReturnValueOnce(JSON.stringify(mockInstanceConfig2));

      const result = await getAllInstances();

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(mockInstancesBaseDir, { recursive: true });
      expect(mockedFs.readdirSync).toHaveBeenCalled();
      expect(result).toEqual([mockInstanceConfig, mockInstanceConfig2]);
    });

    it('should handle directory that already exists', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([] as any);

      const result = await getAllInstances();

      expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should filter out instances with invalid config files', async () => {
      mockedFs.existsSync.mockImplementation(p => p !== mockInstancesBaseDir);
      mockedFs.readdirSync.mockReturnValue(['valid-instance', 'invalid-instance'] as any);
      mockedFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(mockInstanceConfig))
        .mockReturnValueOnce('invalid json');

      const result = await getAllInstances();

      expect(result).toEqual([{ ...mockInstanceConfig, id: 'valid-instance' }]);
    });

    it('lets the directory name win over a stale id in config.json', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue(['new-dir-id'] as any);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'old-id', name: 'Imported' }));

      const result = await getAllInstances();

      expect(result).toEqual([{ id: 'new-dir-id', name: 'Imported' }]);
    });

    it('reads a config.json saved with a byte order mark', async () => {
      // Notepad and PowerShell 5 write one, and the server still belongs in the list.
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue(['test-instance-1'] as any);
      mockedFs.readFileSync.mockReturnValue(`\uFEFF${JSON.stringify(mockInstanceConfig)}`);

      expect(await getAllInstances()).toEqual([mockInstanceConfig]);
    });

    it('should handle empty directory', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.readdirSync.mockReturnValue([] as any);

      expect(await getAllInstances()).toEqual([]);
    });
  });

  describe('getInstance', () => {
    it('should return instance config when it exists', () => {
      const mockConfigPath = `${mockInstancesBaseDir}/test-instance-1/config.json`;
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockInstanceConfig));

      const result = getInstance('test-instance-1');

      expect(mockedFs.existsSync).toHaveBeenCalledWith(mockConfigPath);
      expect(mockedFs.readFileSync).toHaveBeenCalledWith(mockConfigPath, 'utf8');
      expect(result).toEqual(mockInstanceConfig);
    });

    it('lets the directory name win over a stale id in config.json', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'old-id', name: 'Imported' }));

      expect(getInstance('new-dir-id')).toEqual({ id: 'new-dir-id', name: 'Imported' });
    });

    it('reads a config.json saved with a byte order mark', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(`\uFEFF${JSON.stringify(mockInstanceConfig)}`);

      expect(getInstance('test-instance-1')).toEqual(mockInstanceConfig);
    });

    it('should return null when instance does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      expect(getInstance('nonexistent')).toBe(null);
    });

    it('should return null for invalid instance ID', () => {
      expect(getInstance('')).toBe(null);
    });

    it('should return null for null/undefined instance ID', () => {
      expect(getInstance(null as any)).toBe(null);
      expect(getInstance(undefined as any)).toBe(null);
    });
  });

  describe('saveInstance', () => {
    beforeEach(() => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.readdirSync.mockReturnValue([] as any);
    });

    it('should save new instance with a generated UUID', async () => {
      const expectedId = '0f8fad5b-d9cb-469f-a165-70867728950e';
      jest.mocked(randomUUID).mockReturnValueOnce(expectedId);
      const instanceData = { name: 'New Server', port: 7777 };

      const result = await saveInstance(instanceData);

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(`${mockInstancesBaseDir}/${expectedId}`, { recursive: true });
      expect(mockedWriteJsonAtomic).toHaveBeenCalledWith(
        `${mockInstancesBaseDir}/${expectedId}/config.json`,
        { ...instanceData, id: expectedId }
      );
      expect(result).toEqual({ ...instanceData, id: expectedId });
    });

    it('should save instance with provided ID', async () => {
      const instanceData = { id: 'custom-id', name: 'Custom Server', port: 7777 };

      const result = await saveInstance(instanceData);

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(`${mockInstancesBaseDir}/custom-id`, { recursive: true });
      expect(mockedWriteJsonAtomic).toHaveBeenCalledWith(`${mockInstancesBaseDir}/custom-id/config.json`, instanceData);
      expect(result).toEqual(instanceData);
    });

    it('rejects a traversal id before creating any directory', async () => {
      await expect(saveInstance({ id: '../../evil', name: 'Evil' })).rejects.toThrow('Invalid instance ID format');

      expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
      expect(mockedWriteJsonAtomic).not.toHaveBeenCalled();
    });

    it('does not persist runtime-only fields', async () => {
      const settings = { id: 'custom-id', name: 'Custom Server', sessionName: 'My Server', maxPlayers: 20 };

      const result = await saveInstance({
        ...settings,
        state: 'running',
        status: 'online',
        players: 3,
        memory: 2048,
        cpu: 12.5,
        startedAt: 1700000000000
      });

      expect(mockedWriteJsonAtomic).toHaveBeenCalledWith(`${mockInstancesBaseDir}/custom-id/config.json`, settings);
      expect(result).toEqual(settings);
    });

    it('should return error for duplicate server name', async () => {
      const existingInstance = { id: 'existing-1', name: 'existing server', port: 7778 };
      mockedFs.existsSync.mockImplementation(p =>
        p === mockInstancesBaseDir || p === `${mockInstancesBaseDir}/existing-1/config.json`
      );
      mockedFs.readdirSync.mockReturnValue(['existing-1'] as any);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingInstance));

      const result = await saveInstance({ name: 'Existing Server', port: 7777 });

      expect(result).toEqual({ error: 'A server with this name already exists.' });
      expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
      expect(mockedWriteJsonAtomic).not.toHaveBeenCalled();
    });

    it('should allow updating existing instance with same name', async () => {
      const instanceData = { id: 'existing-1', name: 'Existing Server', port: 7777 };
      const existingInstance = { id: 'existing-1', name: 'existing server', port: 7778 };
      const mockConfigPath = `${mockInstancesBaseDir}/existing-1/config.json`;
      mockedFs.existsSync.mockImplementation(p => p === mockInstancesBaseDir || p === mockConfigPath);
      mockedFs.readdirSync.mockReturnValue(['existing-1'] as any);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingInstance));

      const result = await saveInstance(instanceData);

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(`${mockInstancesBaseDir}/existing-1`, { recursive: true });
      expect(mockedWriteJsonAtomic).toHaveBeenCalledWith(mockConfigPath, instanceData);
      expect(result).toEqual(instanceData);
    });

    it('should handle case-insensitive name comparison', async () => {
      const existingInstance = { id: 'existing-1', name: 'existing server', port: 7778 };
      mockedFs.existsSync.mockImplementation(p =>
        p === mockInstancesBaseDir || p === `${mockInstancesBaseDir}/existing-1/config.json`
      );
      mockedFs.readdirSync.mockReturnValue(['existing-1'] as any);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingInstance));

      const result = await saveInstance({ name: 'EXISTING SERVER', port: 7777 });

      expect(result).toEqual({ error: 'A server with this name already exists.' });
    });
  });

  describe('saveInstance ports', () => {
    const one = { id: 'existing-1', name: 'One', gamePort: 7777, queryPort: 27015, rconPort: 27020 };
    const two = { id: 'existing-2', name: 'Two', gamePort: 7787, queryPort: 27025, rconPort: 27030 };

    function onDisk(...instances: Array<{ id: string }>): void {
      const byPath = new Map(instances.map(inst => [`${mockInstancesBaseDir}/${inst.id}/config.json`, inst]));
      mockedFs.existsSync.mockImplementation(p => p === mockInstancesBaseDir || byPath.has(String(p)));
      mockedFs.readdirSync.mockReturnValue(instances.map(inst => inst.id) as any);
      mockedFs.readFileSync.mockImplementation(p => JSON.stringify(byPath.get(String(p))));
    }

    it('moves a new server onto the next free port set when its ports collide', async () => {
      onDisk(one);

      const result = await saveInstance({ name: 'New', gamePort: 7777, queryPort: 27015, rconPort: 27020 });

      expect(result).toEqual(expect.objectContaining({ gamePort: 7787, queryPort: 27025, rconPort: 27030 }));
      expect(mockedWriteJsonAtomic).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ gamePort: 7787 }));
    });

    it('keeps the ports of a new server when nothing else uses them', async () => {
      onDisk(one);

      const result = await saveInstance({ name: 'New', gamePort: 7800, queryPort: 27100, rconPort: 27200 });

      expect(result).toEqual(expect.objectContaining({ gamePort: 7800, queryPort: 27100, rconPort: 27200 }));
    });

    it('rejects moving an existing server onto a port another server uses', async () => {
      onDisk(one, two);

      const result = await saveInstance({ ...two, gamePort: 7777 });

      expect(result).toEqual({ error: 'UDP port 7777 is already used by "One".' });
      expect(mockedWriteJsonAtomic).not.toHaveBeenCalled();
    });

    it('lets an existing server keep its own ports', async () => {
      onDisk(one, two);

      const result = await saveInstance({ ...two, name: 'Two renamed' });

      expect(result).toEqual(expect.objectContaining({ gamePort: 7787, name: 'Two renamed' }));
    });
  });

  describe('deleteInstance', () => {
    it('should delete existing instance directory', () => {
      const mockDir = `${mockInstancesBaseDir}/test-instance-1`;
      mockedFs.existsSync.mockReturnValue(true);

      const result = deleteInstance('test-instance-1');

      expect(mockedFs.existsSync).toHaveBeenCalledWith(mockDir);
      expect(mockedFs.rmSync).toHaveBeenCalledWith(mockDir, { recursive: true, force: true });
      expect(result).toBe(true);
    });

    it('should return false when instance does not exist', () => {
      const mockDir = `${mockInstancesBaseDir}/nonexistent`;
      mockedFs.existsSync.mockReturnValue(false);

      const result = deleteInstance('nonexistent');

      expect(mockedFs.existsSync).toHaveBeenCalledWith(mockDir);
      expect(mockedFs.rmSync).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it.each(['', '../etc', 'bad id with spaces'])('should return false for the id %p', id => {
      expect(deleteInstance(id)).toBe(false);
      expect(mockedFs.existsSync).not.toHaveBeenCalled();
      expect(mockedFs.rmSync).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle filesystem errors gracefully', async () => {
      mockedFs.existsSync.mockImplementation(() => {
        throw new Error('Filesystem error');
      });

      await expect(getAllInstances()).rejects.toThrow('Filesystem error');
    });

    it('should handle JSON parse errors in getInstance', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('invalid json');

      expect(() => getInstance('test-instance-1')).toThrow();
    });

    it('never passes on the parser message, which can quote the file', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('hunter2 is the password');

      let thrown: unknown;
      try {
        getInstance('test-instance-1');
      } catch (error) {
        thrown = error;
      }

      expect(thrown).not.toBeInstanceOf(SyntaxError);
      expect((thrown as Error).message).toBe('The config.json of server test-instance-1 is not valid JSON.');
    });
  });

  describe('getInstanceSaveDir', () => {
    it('should return the SavedArks path for an instanceDir', () => {
      const instanceDir = `${mockInstancesBaseDir}/test-instance-1`;

      expect(getInstanceSaveDir(instanceDir)).toBe(`${instanceDir}/SavedArks`);
    });
  });
});
