import { describe, expect, it, vi } from 'vitest';
import { CronScheduler } from './scheduler';
import type { CronSchedule, IStateStore } from '@opencode/shared';

function makeStore(schedules: CronSchedule[]): IStateStore {
  return {
    list: vi.fn(async () => schedules),
    update: vi.fn(async () => undefined)
  } as unknown as IStateStore;
}

describe('CronScheduler hardening', () => {
  it('ignores invalid and future lastRunAt values without stopping other schedules', async () => {
    const valid: CronSchedule = {
      id: 'valid', name: 'valid', cronExpression: '* * * * *', timezone: 'UTC', isActive: true,
      missedCatchup: true, lastRunAt: '2020-01-01T00:00:00.000Z', workflowId: 'wf'
    };
    const invalid: CronSchedule = {
      id: 'invalid', name: 'invalid', cronExpression: '* * * * *', timezone: 'UTC', isActive: true,
      missedCatchup: true, lastRunAt: 'not-a-date', workflowId: 'wf'
    };
    const future: CronSchedule = {
      id: 'future', name: 'future', cronExpression: '* * * * *', timezone: 'UTC', isActive: true,
      missedCatchup: true, lastRunAt: '2030-01-01T00:00:00.000Z', workflowId: 'wf'
    };
    const store = makeStore([invalid, future, valid]);
    const callback = vi.fn(async () => 'execution-id');
    const scheduler = new CronScheduler(store, callback);

    await scheduler.checkMissedRuns(store, new Date('2020-01-01T00:05:00.000Z'));

    expect(callback).toHaveBeenCalledTimes(5);
    expect(store.update).toHaveBeenCalledWith('schedules', 'valid', {
      lastRunAt: '2020-01-01T00:05:00.000Z'
    });
  });

  it('continues catch-up processing when one schedule fails', async () => {
    const schedule = (id: string): CronSchedule => ({
      id, name: id, cronExpression: '* * * * *', timezone: 'UTC', isActive: true,
      missedCatchup: true, lastRunAt: '2020-01-01T00:00:00.000Z', workflowId: 'wf'
    });
    const store = makeStore([schedule('first'), schedule('second')]);
    const callback = vi.fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValue('execution-id');
    const scheduler = new CronScheduler(store, callback);

    await scheduler.checkMissedRuns(store, new Date('2020-01-01T00:01:00.000Z'));

    expect(callback).toHaveBeenCalledTimes(2);
    expect(store.update).toHaveBeenCalledWith('schedules', 'second', {
      lastRunAt: '2020-01-01T00:01:00.000Z'
    });
  });
});
