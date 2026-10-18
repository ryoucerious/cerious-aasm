import { RconScheduleService, validateRconSchedules, nextRconRun, RconSchedule } from './rcon-schedule.service';
import { getInstance } from '../utils/ark/instance.utils';
import { rconService } from './rcon.service';
import { localNode, meshServer } from './mesh/mesh-hooks';
jest.mock('../utils/ark/instance.utils', () => ({ getInstance: jest.fn() }));
jest.mock('./rcon.service', () => ({ rconService: { executeRconCommand: jest.fn(async () => ({ success: true })) } }));
jest.mock('./mesh/mesh-hooks', () => ({ localNode: jest.fn(() => null), meshServer: jest.fn(() => null) }));

describe('Scheduled RCON', () => {
  const job: RconSchedule = { id: 'wipe', enabled: true, command: 'DestroyWildDinos', mode: 'interval', intervalMinutes: 1 };
  beforeEach(() => {
    jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 9, 18, 12, 0));
    jest.mocked(localNode).mockReturnValue(null);
    jest.mocked(meshServer).mockReturnValue(null);
  });
  afterEach(() => jest.useRealTimers());
  it.each([null, 'here'])('executes only on the hosting process (node %p)', async node => {
    jest.mocked(localNode).mockReturnValue(node);
    jest.mocked(meshServer).mockReturnValue(node ? { nodeId: node } as any : null);
    jest.mocked(getInstance).mockReturnValue({ rconSchedules: [job] });
    const service = new RconScheduleService();
    await service.tick('a');
    jest.advanceTimersByTime(60_000);
    await service.tick('a');
    expect(rconService.executeRconCommand).toHaveBeenCalledTimes(1);
    jest.mocked(meshServer).mockReturnValue({ nodeId: 'elsewhere' } as any);
    jest.advanceTimersByTime(60_000);
    await service.tick('a');
    expect(rconService.executeRconCommand).toHaveBeenCalledTimes(1);
    // Returning ownership arms a fresh timer, never replaying missed commands.
    jest.mocked(meshServer).mockReturnValue(node ? { nodeId: node } as any : null);
    await service.tick('a');
    expect(rconService.executeRconCommand).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60_000);
    await service.tick('a');
    expect(rconService.executeRconCommand).toHaveBeenCalledTimes(2);
  });
  it('runs independent commands at minute intervals and stops disabled/deleted jobs', async () => {
    const service = new RconScheduleService();
    const jobs = [job, { ...job, id: 'save', command: 'SaveWorld', intervalMinutes: 2 }];
    jest.mocked(getInstance).mockReturnValue({ rconSchedules: jobs });
    await service.tick('a');
    expect(rconService.executeRconCommand).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    await service.tick('a');
    expect(rconService.executeRconCommand).toHaveBeenCalledTimes(1);
    expect(rconService.executeRconCommand).toHaveBeenCalledWith('a', 'DestroyWildDinos', undefined, expect.any(Function));
    jest.advanceTimersByTime(60_000);
    await service.tick('a');
    expect(rconService.executeRconCommand).toHaveBeenCalledWith('a', 'SaveWorld', undefined, expect.any(Function));
    jest.mocked(getInstance).mockReturnValue({ rconSchedules: [] });
    jest.advanceTimersByTime(60_000);
    await service.tick('a');
    expect(rconService.executeRconCommand).toHaveBeenCalledTimes(3);
  });
  it('chooses the next daily time and rolls over midnight', () => {
    const daily: RconSchedule = { ...job, mode: 'daily', times: ['06:00', '18:00'] };
    expect(new Date(nextRconRun(daily, Date.now())).getHours()).toBe(18);
    const evening = new Date(2026, 9, 18, 19).getTime();
    expect(new Date(nextRconRun(daily, evening))).toEqual(new Date(2026, 9, 19, 6));
  });
  it.each([null, 'here'])('skips a removed due schedule while another command is running (host %p)', async node => {
    jest.mocked(localNode).mockReturnValue(node);
    jest.mocked(meshServer).mockReturnValue(node ? { nodeId: node } as any : null);
    const first = { ...job, id: 'save', command: 'SaveWorld' };
    jest.mocked(getInstance).mockReturnValue({ rconSchedules: [first, job] });
    const service = new RconScheduleService();
    await service.tick('a');
    jest.advanceTimersByTime(60_000);
    let finish!: (value: any) => void;
    jest.mocked(rconService.executeRconCommand).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const running = service.tick('a');
    jest.mocked(getInstance).mockReturnValue({ rconSchedules: [first] });
    finish({ success: true });
    await running;
    expect(rconService.executeRconCommand).toHaveBeenCalledTimes(1);
    expect(jest.mocked(rconService.executeRconCommand).mock.calls[0][1]).toBe('SaveWorld');
    jest.mocked(getInstance).mockReturnValue({ rconSchedules: [] });
    expect(jest.mocked(rconService.executeRconCommand).mock.calls[0][3]!()).toBe(false);
    jest.advanceTimersByTime(120_000);
    await service.tick('a');
    expect(rconService.executeRconCommand).toHaveBeenCalledTimes(1);
  });
  it('does not overlap a slow command or replay a missed occurrence', async () => {
    const service = new RconScheduleService();
    jest.mocked(getInstance).mockReturnValue({ rconSchedules: [job] });
    await service.tick('a');
    jest.advanceTimersByTime(60_000);
    let finish!: (value: any) => void;
    jest.mocked(rconService.executeRconCommand).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const tick = service.tick('a');
    await service.tick('a');
    expect(rconService.executeRconCommand).toHaveBeenCalledTimes(1);
    finish({ success: false });
    await tick;
    await service.tick('a');
    expect(rconService.executeRconCommand).toHaveBeenCalledTimes(1);
  });
  it.each([{ ...job, intervalMinutes: 0 }, { ...job, command: 'a\nb' }, { ...job, mode: 'daily', times: ['25:00'] }])('rejects invalid schedule %p', invalid => {
    expect(() => validateRconSchedules([invalid])).toThrow();
  });
});
