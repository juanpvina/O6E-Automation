import { IStateStore, QueueEntry } from '@opencode/shared';

export class ProjectQueueManager {
  private activeExecutions = new Map<string, string>(); // projectId -> executionId
  private queues = new Map<string, { executionId: string; runCallback: (signal?: AbortSignal) => Promise<void> }[]>();
  jobTimeoutMs: number;
  private store?: IStateStore;

  constructor(jobTimeoutMs: number = 5 * 60 * 1000, store?: IStateStore) {
    this.jobTimeoutMs = jobTimeoutMs;
    this.store = store;
  }

  async enqueue(projectId: string, executionId: string, runCallback: (signal?: AbortSignal) => Promise<void>): Promise<void> {
    if (!this.queues.has(projectId)) {
      this.queues.set(projectId, []);
    }
    this.queues.get(projectId)!.push({ executionId, runCallback });

    if (this.store) {
      // Durable marker only; the runCallback is intentionally not persisted.
      await this.store.set<QueueEntry>('queue', executionId, {
        id: executionId,
        projectId,
        enqueuedAt: new Date().toISOString()
      });
    }

    // Process queue asynchronously
    this.processQueue(projectId);
  }

  // Re-enqueues executions that were still pending when the process shut down.
  // The caller provides enqueueFn (e.g. wiring the execution back through the
  // executor); each persisted marker is deleted once it has been re-enqueued.
  async recover(store: IStateStore, enqueueFn: (projectId: string, executionId: string) => Promise<void> | void): Promise<void> {
    const entries = await store.list<QueueEntry>('queue');
    for (const entry of entries) {
      try {
        await enqueueFn(entry.projectId, entry.id);
      } catch (err) {
        console.error(`Error recovering queued execution ${entry.id} in queue:`, err);
        continue;
      }
      await store.delete('queue', entry.id);
    }
  }

  private async processQueue(projectId: string): Promise<void> {
    if (this.activeExecutions.has(projectId)) {
      // Already running a task for this project
      return;
    }

    const queue = this.queues.get(projectId) || [];
    if (queue.length === 0) {
      return;
    }

    const nextTask = queue.shift()!;
    this.activeExecutions.set(projectId, nextTask.executionId);

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      console.error(`Execution ${nextTask.executionId} timed out after ${this.jobTimeoutMs}ms; aborting child process.`);
      controller.abort();
    }, this.jobTimeoutMs);

    try {
      await nextTask.runCallback(controller.signal);
      if (timedOut) {
        console.error(`Execution ${nextTask.executionId} aborted after timeout; child process killed.`);
      }
    } catch (err) {
      console.error(`Error running execution ${nextTask.executionId} in queue:`, err);
    } finally {
      clearTimeout(timeout);
      this.activeExecutions.delete(projectId);
      if (this.store) {
        // Job finished; clear the durable pending marker.
        await this.store.delete('queue', nextTask.executionId);
      }
      // Process next in line
      this.processQueue(projectId);
    }
  }

  getActiveExecution(projectId: string): string | undefined {
    return this.activeExecutions.get(projectId);
  }

  getQueueLength(projectId: string): number {
    return (this.queues.get(projectId) || []).length;
  }

  // Health helper: all project ids that have pending or active work.
  getAllProjectIds(): string[] {
    return Array.from(new Set([
      ...this.queues.keys(),
      ...this.activeExecutions.keys()
    ]));
  }
}
