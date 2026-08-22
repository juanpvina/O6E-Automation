import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileStateStore, FirestoreStateStore, PostgresStateStore } from './store';

const mockDoc = {
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

const mockCollection = {
  doc: vi.fn(() => mockDoc),
  get: vi.fn(),
};

const mockFirestore = {
  collection: vi.fn(() => mockCollection),
  runTransaction: vi.fn(),
};

vi.mock('@google-cloud/firestore', () => {
  return {
    Firestore: function() {
      return mockFirestore;
    },
  };
});

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

const mockPool = {
  query: vi.fn(),
  connect: vi.fn(() => Promise.resolve(mockClient)),
};

vi.mock('pg', () => {
  return {
    Pool: function() {
      return mockPool;
    },
  };
});

interface Doc {
  id: string;
  name: string;
  version: number;
  tags?: string[];
}

describe('FileStateStore', () => {
  let tmpDir: string;
  let store: FileStateStore;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-store-test-'));
    store = new FileStateStore(tmpDir);
    await store.initialize();
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('get devuelve null para un documento inexistente', async () => {
    expect(await store.get<Doc>('projects', 'missing')).toBeNull();
  });

  it('set + get hacen roundtrip', async () => {
    const doc: Doc = { id: 'p1', name: 'Project One', version: 1 };
    await store.set<Doc>('projects', 'p1', doc);
    expect(await store.get<Doc>('projects', 'p1')).toEqual(doc);
  });

  it('preserva el formato JSON anidado y sus tipos', async () => {
    const execution = {
      id: 'execution-json',
      status: 'succeeded',
      triggerPayload: { enabled: true, count: 2, tags: ['ops', 'daily'] },
      stepOutputs: {
        transform: { result: { rows: [{ name: 'Ada', score: 9.5 }], empty: null } }
      }
    };

    await store.set('executions', execution.id, execution);

    expect(await store.get('executions', execution.id)).toEqual(execution);
  });

  it('retiene ejecuciones hasta que se borran explicitamente', async () => {
    await store.set('executions', 'retained-old', { id: 'retained-old', status: 'succeeded' });
    await store.set('executions', 'retained-new', { id: 'retained-new', status: 'failed' });

    const beforeDelete = await store.list<{ id: string; status: string }>('executions');
    expect(beforeDelete.map((item) => item.id)).toEqual(expect.arrayContaining(['retained-old', 'retained-new']));

    await store.delete('executions', 'retained-old');

    expect(await store.get('executions', 'retained-old')).toBeNull();
    expect(await store.get('executions', 'retained-new')).toEqual({ id: 'retained-new', status: 'failed' });
  });

  it('set sobreescribe el documento existente', async () => {
    await store.set<Doc>('projects', 'p1', { id: 'p1', name: 'Project One v2', version: 2 });
    const got = await store.get<Doc>('projects', 'p1');
    expect(got).not.toBeNull();
    expect(got!.name).toBe('Project One v2');
    expect(got!.version).toBe(2);
  });

  it('list devuelve todos los documentos de una colección', async () => {
    const items = await store.list<Doc>('projects');
    const ids = items.map((i) => i.id).sort();
    expect(ids).toEqual(['p1']);
  });

  it('list soporta un filtro', async () => {
    await store.set<Doc>('projects', 'p2', { id: 'p2', name: 'Project Two', version: 1 });
    const filtered = await store.list<Doc>('projects', (d) => d.version > 1);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('p1');
  });

  it('list devuelve [] para una colección inexistente', async () => {
    expect(await store.list<Doc>('nonexistent')).toEqual([]);
  });

  it('update fusiona parcialmente el documento', async () => {
    await store.update<Doc>('projects', 'p2', { name: 'Project Two Renamed' });
    const got = await store.get<Doc>('projects', 'p2');
    expect(got!.id).toBe('p2');
    expect(got!.name).toBe('Project Two Renamed');
    expect(got!.version).toBe(1);
  });

  it('update lanza si el documento no existe', async () => {
    await expect(store.update<Doc>('projects', 'ghost', { name: 'x' })).rejects.toThrow(
      /not found/
    );
  });

  it('delete elimina el documento y no lanza si no existe', async () => {
    await store.delete('projects', 'p2');
    expect(await store.get<Doc>('projects', 'p2')).toBeNull();
    await expect(store.delete('projects', 'p2')).resolves.toBeUndefined();
  });

  describe('compareAndSwap', () => {
    it('tiene éxito cuando la versión esperada coincide', async () => {
      const base: Doc = { id: 'p3', name: 'CAS base', version: 1 };
      await store.set<Doc>('projects', 'p3', base);

      const next: Doc = { id: 'p3', name: 'CAS updated', version: 2 };
      const ok = await store.compareAndSwap<Doc>('projects', 'p3', 1, next);
      expect(ok).toBe(true);

      const got = await store.get<Doc>('projects', 'p3');
      expect(got!.name).toBe('CAS updated');
      expect(got!.version).toBe(2);
    });

    it('falla cuando la versión esperada no coincide', async () => {
      await store.set<Doc>('projects', 'p4', { id: 'p4', name: 'v3 doc', version: 3 });
      const ok = await store.compareAndSwap<Doc>('projects', 'p4', 2, { id: 'p4', name: 'stale write', version: 3 });
      expect(ok).toBe(false);
      const got = await store.get<Doc>('projects', 'p4');
      expect(got!.name).toBe('v3 doc');
    });

    it('falla si el documento no existe', async () => {
      const ok = await store.compareAndSwap<Doc>('projects', 'ghost', 1, { id: 'ghost', name: 'x', version: 1 });
      expect(ok).toBe(false);
    });
  });

  it('tolera JSON corrupto devolviendo null', async () => {
    const collDir = path.join(tmpDir, 'projects');
    await fs.writeFile(path.join(collDir, 'corrupt.json'), '{not valid json', 'utf8');
    expect(await store.get<Doc>('projects', 'corrupt')).toBeNull();
    await fs.unlink(path.join(collDir, 'corrupt.json'));
  });
});

describe('FirestoreStateStore', () => {
  let store: FirestoreStateStore;

  beforeAll(async () => {
    store = new FirestoreStateStore();
    await store.initialize();
  });

  it('get returns null if doc does not exist', async () => {
    mockDoc.get.mockResolvedValueOnce({ exists: false });
    const val = await store.get('projects', 'p1');
    expect(val).toBeNull();
    expect(mockCollection.doc).toHaveBeenCalledWith('p1');
  });

  it('get returns data if doc exists', async () => {
    const data = { id: 'p1', name: 'Firestore Doc' };
    mockDoc.get.mockResolvedValueOnce({ exists: true, data: () => data });
    const val = await store.get('projects', 'p1');
    expect(val).toEqual(data);
  });

  it('set saves the document', async () => {
    const data = { id: 'p1', name: 'Firestore Doc' };
    mockDoc.set.mockResolvedValueOnce(undefined);
    await store.set('projects', 'p1', data);
    expect(mockDoc.set).toHaveBeenCalledWith(data);
  });

  it('update merges data and throws if doc does not exist', async () => {
    mockDoc.get.mockResolvedValueOnce({ exists: false });
    await expect(store.update('projects', 'p1', { name: 'New' })).rejects.toThrow();

    mockDoc.get.mockResolvedValueOnce({ exists: true, data: () => ({ id: 'p1', name: 'Old' }) });
    mockDoc.update.mockResolvedValueOnce(undefined);
    await store.update('projects', 'p1', { name: 'New' });
    expect(mockDoc.update).toHaveBeenCalledWith({ name: 'New' });
  });

  it('delete removes the document', async () => {
    mockDoc.delete.mockResolvedValueOnce(undefined);
    await store.delete('projects', 'p1');
    expect(mockDoc.delete).toHaveBeenCalled();
  });

  it('list returns all docs and respects filter', async () => {
    const docs = [
      { data: () => ({ id: 'p1', version: 1 }) },
      { data: () => ({ id: 'p2', version: 2 }) },
    ];
    mockCollection.get.mockResolvedValueOnce({
      forEach: (cb: any) => docs.forEach(cb),
    });
    const results = await store.list<any>('projects', (d) => d.version > 1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('p2');
  });

  it('compareAndSwap transaction execution', async () => {
    mockFirestore.runTransaction.mockImplementationOnce(async (cb: any) => {
      const trans = {
        get: vi.fn().mockResolvedValueOnce({
          exists: true,
          data: () => ({ id: 'p1', version: 1 }),
        }),
        set: vi.fn(),
      };
      await cb(trans);
    });
    const res = await store.compareAndSwap('projects', 'p1', 1, { id: 'p1', version: 2 });
    expect(res).toBe(true);
  });
});

describe('PostgresStateStore', () => {
  let store: PostgresStateStore;

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
    store = new PostgresStateStore();
    await store.initialize();
  });

  it('get returns null if query is empty', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const val = await store.get('projects', 'p1');
    expect(val).toBeNull();
  });

  it('get returns data if query is not empty', async () => {
    const data = { id: 'p1', name: 'Postgres Doc' };
    mockPool.query.mockResolvedValueOnce({ rows: [{ data }] });
    const val = await store.get('projects', 'p1');
    expect(val).toEqual(data);
  });

  it('set inserts or updates data', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const data = { id: 'p1', name: 'Postgres Doc' };
    await store.set('projects', 'p1', data);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO opencode_store'),
      ['projects', 'p1', JSON.stringify(data)]
    );
  });

  it('delete removes record', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await store.delete('projects', 'p1');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM opencode_store'),
      ['projects', 'p1']
    );
  });

  it('list returns records matching filters', async () => {
    const rows = [
      { data: { id: 'p1', version: 1 } },
      { data: { id: 'p2', version: 2 } },
    ];
    mockPool.query.mockResolvedValueOnce({ rows });
    const results = await store.list<any>('projects', (d) => d.version > 1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('p2');
  });

  it('compareAndSwap commits transaction on match', async () => {
    mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [{ data: { id: 'p1', version: 1 } }] }); // SELECT
    mockClient.query.mockResolvedValueOnce(undefined); // UPDATE
    mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

    const success = await store.compareAndSwap('projects', 'p1', 1, { id: 'p1', version: 2 });
    expect(success).toBe(true);
  });

  it('compareAndSwap rolls back transaction on mismatch', async () => {
    mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [{ data: { id: 'p1', version: 1 } }] }); // SELECT
    mockClient.query.mockResolvedValueOnce(undefined); // ROLLBACK

    const success = await store.compareAndSwap('projects', 'p1', 2, { id: 'p1', version: 2 });
    expect(success).toBe(false);
  });
});
