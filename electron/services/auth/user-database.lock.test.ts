import { jest } from '@jest/globals';
import * as fs from 'fs';
import { UserDatabaseService } from './user-database.service';

const mockFs = fs as jest.Mocked<typeof fs>;

/**
 * The driver locks by creating a "<db>.lock" directory around each write and removes it
 * afterwards, so a process killed mid-write leaves one behind and every later write fails
 * with "database is locked". These tests pin the rule that decides whether such a lock may
 * be cleared: only when the process that claimed the database is no longer running.
 */
describe('UserDatabaseService lock ownership', () => {
  let service: any;
  const DB = '/data/users.db';
  const LOCK = '/data/users.db.lock';
  const PID = '/data/users.db.pid';

  /** Files that "exist", and what the pid file holds. */
  let present: Set<string>;
  let pidContents: string;
  /** Paths the service asked to delete. */
  let removedPaths: () => string[];

  beforeEach(() => {
    jest.clearAllMocks();
    present = new Set<string>();
    pidContents = '';

    // The shared fs mock in test/setup.ts does not cover every call this service makes.
    for (const name of ['existsSync', 'readFileSync', 'writeFileSync', 'rmSync', 'mkdirSync'] as const) {
      if (typeof (mockFs as any)[name] !== 'function' || !(mockFs as any)[name].mockImplementation) {
        (mockFs as any)[name] = jest.fn();
      }
    }

    (mockFs.existsSync as jest.Mock).mockImplementation((p: any) => present.has(String(p)));
    (mockFs.readFileSync as jest.Mock).mockImplementation((p: any) => {
      if (String(p) === PID) return pidContents;
      throw new Error('ENOENT');
    });
    (mockFs.writeFileSync as jest.Mock).mockImplementation((p: any, data: any) => {
      if (String(p) === PID) { pidContents = String(data); present.add(PID); }
    });
    (mockFs.rmSync as jest.Mock).mockImplementation((p: any) => { present.delete(String(p)); });
    removedPaths = () => (mockFs.rmSync as jest.Mock).mock.calls.map((call: any[]) => String(call[0]));

    service = new UserDatabaseService();
    service.dbPath = DB;
    service.pidPath = PID;
  });

  describe('ownerIsAlive', () => {
    it('is false when nothing has claimed the database', () => {
      expect(service.ownerIsAlive()).toBe(false);
    });

    it('is false when the recorded process is gone', () => {
      present.add(PID);
      pidContents = '999999';
      jest.spyOn(process, 'kill').mockImplementation(() => { const e: any = new Error('ESRCH'); e.code = 'ESRCH'; throw e; });
      expect(service.ownerIsAlive()).toBe(false);
    });

    it('is false when the claim is our own process', () => {
      present.add(PID);
      pidContents = String(process.pid);
      expect(service.ownerIsAlive()).toBe(false);
    });

    it('is true when the recorded process is still running', () => {
      present.add(PID);
      pidContents = '4242';
      jest.spyOn(process, 'kill').mockImplementation(() => true as any);
      expect(service.ownerIsAlive()).toBe(true);
    });

    it('is false when the pid file holds nonsense', () => {
      present.add(PID);
      pidContents = 'not-a-pid';
      expect(service.ownerIsAlive()).toBe(false);
    });
  });

  describe('releaseStaleLock', () => {
    it('reports success when there is no lock at all', () => {
      expect(service.releaseStaleLock()).toBe(true);
      expect(mockFs.rmSync).not.toHaveBeenCalled();
    });

    it('clears a lock left behind by a process that has exited', () => {
      present.add(LOCK);
      present.add(PID);
      pidContents = '999999';
      jest.spyOn(process, 'kill').mockImplementation(() => { const e: any = new Error('ESRCH'); e.code = 'ESRCH'; throw e; });

      expect(service.releaseStaleLock()).toBe(true);
      expect(removedPaths()).toContain(LOCK);
    });

    it('leaves a lock alone while its owner is still running', () => {
      present.add(LOCK);
      present.add(PID);
      pidContents = '4242';
      jest.spyOn(process, 'kill').mockImplementation(() => true as any);

      expect(service.releaseStaleLock()).toBe(false);
      expect(removedPaths()).not.toContain(LOCK);
    });
  });

  describe('claimOwnership', () => {
    it('records this process when the database is free', () => {
      service.claimOwnership();
      expect(pidContents).toBe(String(process.pid));
    });

    it('takes over a claim left by an earlier run', () => {
      present.add(PID);
      pidContents = '4242';
      jest.spyOn(process, 'kill').mockImplementation(() => true as any);

      service.claimOwnership();

      // A claim is only made after a write succeeded, which proves nobody else holds the
      // lock. Leaving the old pid in place is what let a dead pid stand for the live owner,
      // so the next run cleared a lock that was still in use.
      expect(pidContents).toBe(String(process.pid));
    });
  });

  describe('close', () => {
    it('removes our own lock and claim', () => {
      present.add(LOCK);
      present.add(PID);
      pidContents = String(process.pid);

      service.close();

      expect(removedPaths()).toContain(LOCK);
      expect(removedPaths()).toContain(PID);
    });

    it('leaves another running instance lock and claim untouched', () => {
      present.add(LOCK);
      present.add(PID);
      pidContents = '4242';
      jest.spyOn(process, 'kill').mockImplementation(() => true as any);

      service.close();

      expect(removedPaths()).not.toContain(LOCK);
      expect(pidContents).toBe('4242');
    });
  });
});
