import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ExecutionPersistence, ExecutionStateStore } from './execution-persistence';
import { NoSqlDocumentStore } from './nosql';
import { FileStateStore, listPage, safeDocumentId } from './store';

describe('persistence helpers', () => {
  let directory: string;
  let store: FileStateStore;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-persistence-test-'));
    store = new FileStateStore(directory);
    await store.initialize();
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('rejects document IDs that could escape the collection directory', async () => {
    expect(() => safeDocumentId('../outside')).toThrow(/Unsafe document ID/);
    await expect(store.set('projects', '../outside', { id: 'outside' })).rejects.toThrow(/Unsafe document ID/);
    expect(await fs.stat(path.join(directory, 'outside.json')).catch(() => null)).toBeNull();
  });

  it('paginates and filters through the existing store interface', async () => {
    await store.set('projects', 'one', { id: 'one', active: true });
    await store.set('projects', 'two', { id: 'two', active: false });
    await store.set('projects', 'three', { id: 'three', active: true });

    const page = await listPage<{ id: string; active: boolean }>(store, 'projects', {
      filter: (item) => item.active,
      sort: (a, b) => a.id.localeCompare(b.id),
      offset: 1,
      limit: 1
    });
    expect(page.items.map((item) => item.id)).toEqual(['three']);
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(false);
  });

  it('stores logs and artifacts in separate collections with safe deterministic IDs', async () => {
    const executions = new ExecutionPersistence(store);
    await executions.appendLog('execution-1', 0, {
      timestamp: '2026-01-01T00:00:00.000Z', level: 'info', message: 'started'
    });
    const artifactId = await executions.appendArtifact('execution-1', {
      path: '/tmp/output.txt', createdAt: '2026-01-01T00:00:01.000Z'
    });

    expect(await store.list('executionLogs')).toHaveLength(1);
    expect(await store.list('executionArtifacts')).toHaveLength(1);
    expect(artifactId).toMatch(/^execution-1_[a-f0-9]{24}$/);
    expect(await executions.listLogs()).toMatchObject({ total: 1, items: [{ executionId: 'execution-1' }] });
  });

  it('persists each NoSQL document independently', async () => {
    const documents = new NoSqlDocumentStore(store);
    await documents.upsert('db-1', 'events', { id: 'a', value: 1 });
    await documents.upsert('db-1', 'events', { id: 'b', value: 2 });
    await documents.upsert('db-1', 'events', { id: 'a', value: 3 });

    expect(await documents.get('db-1', 'events', 'a')).toEqual({ id: 'a', value: 3 });
    expect(await documents.list<{ id: string }>('db-1', 'events')).toHaveLength(2);
    await documents.delete('db-1', 'events', 'a');
    expect(await documents.get('db-1', 'events', 'b')).toEqual({ id: 'b', value: 2 });
  });

  it('transparently normalizes execution children for existing executor writes', async () => {
    const executionStore = new ExecutionStateStore(store);
    const execution = {
      id: 'exec-1',
      logs: [{ timestamp: '2026-01-01T00:00:00.000Z', level: 'info', message: 'hello' }],
      artifacts: ['/tmp/a.txt'],
      status: 'queued'
    } as any;
    await executionStore.set('executions', execution.id, execution);

    const raw = await store.get<any>('executions', execution.id);
    expect(raw.logs).toEqual([]);
    expect(raw.artifacts).toEqual([]);
    expect((await executionStore.get<any>('executions', execution.id)).logs).toEqual(execution.logs);
    expect(await store.list('executionLogs')).toHaveLength(1);
    expect(await store.list('executionArtifacts')).toHaveLength(1);
  });
});
