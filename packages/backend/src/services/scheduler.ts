import cron from 'node-cron';
import { CronSchedule, IStateStore } from '@opencode/shared';

export class CronScheduler {
  private store: IStateStore;
  private activeJobs = new Map<string, cron.ScheduledTask>();
  private triggerCallback: (projectId: string | undefined, workflowId: string, triggerType: 'cron', payload: any) => Promise<string>;

  // Cap on how many missed runs are re-triggered per schedule during catch-up.
  static readonly MAX_CATCHUP = 5;

  constructor(
    store: IStateStore,
    triggerCallback: (projectId: string | undefined, workflowId: string, triggerType: 'cron', payload: any) => Promise<string>
  ) {
    this.store = store;
    this.triggerCallback = triggerCallback;
  }

  async start(): Promise<void> {
    const schedules = await this.store.list<CronSchedule>('schedules');
    for (const schedule of schedules) {
      if (schedule.isActive) {
        this.register(schedule);
      }
    }
    // After (re)starting, fire catch-up for runs missed while offline.
    try {
      await this.checkMissedRuns();
    } catch (err) {
      console.error('Failed to check missed cron runs; scheduled jobs remain active:', err);
    }
  }

  stop(): void {
    for (const [id, job] of this.activeJobs.entries()) {
      job.stop();
      this.activeJobs.delete(id);
    }
  }

  async reload(): Promise<void> {
    this.stop();
    await this.start();
  }

  register(schedule: CronSchedule): void {
    if (this.activeJobs.has(schedule.id)) {
      this.activeJobs.get(schedule.id)!.stop();
      this.activeJobs.delete(schedule.id);
    }

    try {
      // Validate cron expression
      if (!cron.validate(schedule.cronExpression)) {
        console.error(`Invalid cron expression for schedule ${schedule.id}: ${schedule.cronExpression}`);
        return;
      }

      const job = cron.schedule(
        schedule.cronExpression,
        async () => {
          console.log(`Cron schedule ${schedule.name} (${schedule.id}) triggered.`);
          try {
            if (schedule.missedCatchup && this.isDelayedRun(schedule, new Date())) {
              console.warn(`Cron schedule ${schedule.name} (${schedule.id}) fired very late; pending catch-up runs will be handled by checkMissedRuns.`);
            }
            await this.triggerCallback(schedule.projectId, schedule.workflowId, 'cron', {
              scheduleId: schedule.id,
              cronExpression: schedule.cronExpression,
              triggeredAt: new Date().toISOString()
            });

            // Update last run timestamp
            await this.store.update<CronSchedule>('schedules', schedule.id, {
              lastRunAt: new Date().toISOString()
            });
          } catch (err) {
            console.error(`Error executing workflow for schedule ${schedule.id}:`, err);
          }
        },
        {
          timezone: schedule.timezone || 'America/Bogota'
        }
      );

      this.activeJobs.set(schedule.id, job);
      console.log(`Cron schedule ${schedule.name} (${schedule.id}) registered successfully: ${schedule.cronExpression}`);
    } catch (err) {
      console.error(`Failed to register cron schedule ${schedule.id}:`, err);
    }
  }

  unregister(scheduleId: string): void {
    const job = this.activeJobs.get(scheduleId);
    if (job) {
      job.stop();
      this.activeJobs.delete(scheduleId);
      console.log(`Cron schedule ${scheduleId} unregistered.`);
    }
  }

  // Catch-up for cron runs missed while the process was offline (Fase 6).
  //
  // node-cron (3.0.3) does not replay missed executions and exposes no next-run
  // computation, so this is a pragmatic heuristic: we estimate the schedule's
  // period from the cron minute field, and for every schedule with
  // `missedCatchup === true` whose `lastRunAt` is older than one period we
  // re-trigger the callback once per missed run, capped at MAX_CATCHUP.
  // After catch-up, `lastRunAt` is advanced to now.
  async checkMissedRuns(store: IStateStore = this.store, now: Date = new Date()): Promise<void> {
    const schedules = await store.list<CronSchedule>('schedules');
    for (const schedule of schedules) {
      try {
        if (!schedule.isActive || schedule.missedCatchup !== true || !schedule.lastRunAt) continue;
        const lastRunMs = new Date(schedule.lastRunAt).getTime();
        if (!Number.isFinite(lastRunMs) || lastRunMs > now.getTime()) {
          console.warn(`Ignoring invalid lastRunAt for schedule ${schedule.id}.`);
          continue;
        }
        const intervalMs = CronScheduler.estimateIntervalMs(schedule.cronExpression);
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) continue;
        const elapsedMs = now.getTime() - lastRunMs;
        const missed = Math.floor(elapsedMs / intervalMs);
        if (missed < 1) continue;

        const toRun = Math.min(missed, CronScheduler.MAX_CATCHUP);
        console.log(`Cron schedule ${schedule.name} (${schedule.id}) missed ${missed} run(s); catching up with ${toRun}.`);
        let lastError: unknown;
        for (let i = 0; i < toRun; i++) {
          try {
            await this.triggerCallback(schedule.projectId, schedule.workflowId, 'cron', {
              scheduleId: schedule.id,
              cronExpression: schedule.cronExpression,
              triggeredAt: now.toISOString(),
              catchUp: true,
              missedRunIndex: i + 1
            });
          } catch (err) {
            lastError = err;
            console.error(`Error during catch-up run ${i + 1} for schedule ${schedule.id}:`, err);
          }
        }
        if (lastError !== undefined) {
          console.warn(`Cron schedule ${schedule.name} (${schedule.id}) finished catch-up with errors; lastRunAt not advanced.`);
          continue;
        }
        await store.update<CronSchedule>('schedules', schedule.id, { lastRunAt: now.toISOString() });
      } catch (err) {
        console.error(`Failed processing missed runs for schedule ${schedule.id}:`, err);
      }
    }
  }

  // True when a fired run is more than one estimated period late.
  private isDelayedRun(schedule: CronSchedule, now: Date): boolean {
    if (!schedule.lastRunAt) {
      return false;
    }
    const elapsedMs = now.getTime() - new Date(schedule.lastRunAt).getTime();
    const intervalMs = CronScheduler.estimateIntervalMs(schedule.cronExpression);
    return Number.isFinite(elapsedMs) && elapsedMs >= 2 * intervalMs;
  }

  // Estimates the schedule period (ms) from the cron minute field. Returns a
  // minimum gap, so catch-up never fires *more* often than the expression
  // allows. Fallback to 1 minute when the field is not a simple pattern.
  static estimateIntervalMs(cronExpression: string): number {
    const minuteField = cronExpression.trim().split(/\s+/)[0];
    const values: number[] = [];
    for (const token of minuteField.split(',')) {
      const stepMatch = token.match(/^\*\/(\d+)$/);
      if (stepMatch) {
        values.push(parseInt(stepMatch[1], 10));
        continue;
      }
      const rangeMatch = token.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
      if (rangeMatch) {
        const step = rangeMatch[3] ? parseInt(rangeMatch[3], 10) : 1;
        values.push(step);
        continue;
      }
      if (token === '*') {
        values.push(1);
        continue;
      }
      const n = parseInt(token, 10);
      if (!Number.isNaN(n)) {
        values.push(60);
      }
    }
    if (values.length === 0) {
      return 60 * 1000;
    }
    const minGap = Math.min(...values);
    return Math.max(1, minGap) * 60 * 1000;
  }
}
