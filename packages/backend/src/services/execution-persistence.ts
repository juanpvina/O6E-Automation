import { Execution, ExecutionLog, IStateStore } from '@opencode/shared';
import * as crypto from 'crypto';
import { listPage, ListOptions, ListPage, safeDocumentId } from './store';

export interface ExecutionLogDocument extends ExecutionLog {
  id: string;
  executionId: string;
  sequence: number;
}

export interface ExecutionArtifactDocument {
  id: string;
  executionId: string;
  path: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export class ExecutionPersistence {
  constructor(private readonly store: IStateStore) {}

  async appendLog(executionId: string, sequence: number, log: ExecutionLog): Promise<void> {
    const id = safeDocumentId(`${executionId}_${sequence}`);
    await this.store.set<ExecutionLogDocument>('executionLogs', id, { id, executionId, sequence, ...log });
  }

  async replaceChildren(executionId: string, logs: ExecutionLog[], artifacts: string[]): Promise<void> {
    const [oldLogs, oldArtifacts] = await Promise.all([
      this.store.list<ExecutionLogDocument>('executionLogs', (item) => item.executionId === executionId),
      this.store.list<ExecutionArtifactDocument>('executionArtifacts', (item) => item.executionId === executionId)
    ]);
    const nextLogIds = new Set(logs.map((_log, sequence) => `${executionId}_${sequence}`));
    const nextArtifactIds = new Set(artifacts.map((artifactPath) => this.artifactId(executionId, artifactPath)));
    const oldById = new Map(oldLogs.map((item) => [item.id, item]));
    const oldArtifactById = new Map(oldArtifacts.map((item) => [item.id, item]));

    await Promise.all([
      ...oldLogs.filter((item) => !nextLogIds.has(item.id)).map((item) => this.store.delete('executionLogs', item.id)),
      ...oldArtifacts.filter((item) => !nextArtifactIds.has(item.id)).map((item) => this.store.delete('executionArtifacts', item.id))
    ]);
    await Promise.all(logs.flatMap((log, sequence) => {
      const id = `${executionId}_${sequence}`;
      const next = { id, executionId, sequence, ...log };
      return JSON.stringify(oldById.get(id)) === JSON.stringify(next) ? [] : [this.store.set('executionLogs', id, next)];
    }));
    await Promise.all(artifacts.flatMap((artifactPath) => {
      const id = this.artifactId(executionId, artifactPath);
      const next = { id, executionId, path: artifactPath, createdAt: oldArtifactById.get(id)?.createdAt || new Date().toISOString() };
      return JSON.stringify(oldArtifactById.get(id)) === JSON.stringify(next) ? [] : [this.store.set('executionArtifacts', id, next)];
    }));
  }

  private artifactId(executionId: string, artifactPath: string): string {
    const pathHash = crypto.createHash('sha256').update(artifactPath).digest('hex').slice(0, 24);
    return safeDocumentId(`${executionId}_${pathHash}`);
  }

  async appendArtifact(executionId: string, artifact: Omit<ExecutionArtifactDocument, 'id' | 'executionId'>): Promise<string> {
    const id = this.artifactId(executionId, artifact.path);
    await this.store.set<ExecutionArtifactDocument>('executionArtifacts', id, { id, executionId, ...artifact });
    return id;
  }

  listLogs(options: ListOptions<ExecutionLogDocument> = {}): Promise<ListPage<ExecutionLogDocument>> {
    return listPage(this.store, 'executionLogs', options);
  }

  listArtifacts(options: ListOptions<ExecutionArtifactDocument> = {}): Promise<ListPage<ExecutionArtifactDocument>> {
    return listPage(this.store, 'executionArtifacts', options);
  }
}

/** Transparent adapter used by the server so executor.ts can keep its contract. */
export class ExecutionStateStore implements IStateStore {
  private readonly executions: ExecutionPersistence;

  constructor(private readonly delegate: IStateStore) {
    this.executions = new ExecutionPersistence(delegate);
  }

  initialize(): Promise<void> { return this.delegate.initialize(); }

  async get<T>(collection: string, docId: string): Promise<T | null> {
    const execution = await this.delegate.get<T>(collection, docId);
    if (collection !== 'executions' || !execution) return execution;
    return this.rehydrate(execution as unknown as Execution) as unknown as T;
  }

  async set<T>(collection: string, docId: string, data: T): Promise<void> {
    if (collection !== 'executions') return this.delegate.set(collection, docId, data);
    const execution = data as unknown as Execution;
    const normalized = { ...execution, logs: [], artifacts: [] };
    await this.delegate.set(collection, docId, normalized);
    await this.executions.replaceChildren(docId, execution.logs || [], execution.artifacts || []);
  }

  async update<T>(collection: string, docId: string, data: Partial<T>): Promise<void> {
    if (collection !== 'executions') return this.delegate.update(collection, docId, data);
    const existing = await this.get<T>(collection, docId);
    if (!existing) throw new Error(`Document ${docId} not found in collection ${collection}`);
    await this.set(collection, docId, { ...(existing as object), ...data } as T);
  }

  async delete(collection: string, docId: string): Promise<void> {
    if (collection === 'executions') {
      await this.executions.replaceChildren(docId, [], []);
    }
    await this.delegate.delete(collection, docId);
  }

  async list<T>(collection: string, filter?: (item: T) => boolean): Promise<T[]> {
    const items = await this.delegate.list<T>(collection);
    if (collection !== 'executions') return filter ? items.filter(filter) : items;
    const hydrated = await Promise.all(items.map((item) => this.rehydrate(item as unknown as Execution) as unknown as T));
    return filter ? hydrated.filter(filter) : hydrated;
  }

  async compareAndSwap<T>(collection: string, docId: string, expectedVersion: number, data: T): Promise<boolean> {
    if (collection !== 'executions') {
      return this.delegate.compareAndSwap ? this.delegate.compareAndSwap(collection, docId, expectedVersion, data) : false;
    }
    const execution = data as unknown as Execution;
    const normalized = { ...execution, logs: [], artifacts: [] };
    const success = this.delegate.compareAndSwap
      ? await this.delegate.compareAndSwap(collection, docId, expectedVersion, normalized)
      : false;
    if (success) await this.executions.replaceChildren(docId, execution.logs || [], execution.artifacts || []);
    return success;
  }

  private async rehydrate(execution: Execution): Promise<Execution> {
    const [logs, artifacts] = await Promise.all([
      this.executions.listLogs({
        filter: (item) => item.executionId === execution.id,
        sort: (a, b) => a.sequence - b.sequence
      }),
      this.executions.listArtifacts({ filter: (item) => item.executionId === execution.id })
    ]);
    return {
      ...execution,
      logs: logs.total > 0 ? logs.items.map(({ id: _id, executionId: _executionId, sequence: _sequence, ...log }) => log) : execution.logs || [],
      artifacts: artifacts.total > 0 ? artifacts.items.map((item) => item.path) : execution.artifacts || []
    };
  }
}
