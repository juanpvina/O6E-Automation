import * as fs from 'fs/promises';
import * as path from 'path';
import { IStateStore } from '@opencode/shared';

export const DEFAULT_COLLECTIONS = [
  'projects', 'connections', 'workflows', 'executions', 'executionLogs',
  'executionArtifacts', 'schedules', 'secrets', 'approvals', 'databases'
] as const;

/** Document IDs are used as file names and as provider-native IDs. */
export function safeDocumentId(docId: string): string {
  if (!docId || docId === '.' || docId === '..' || /[\\/:*?"<>|\0-\x1f\x7f]/.test(docId)) {
    throw new Error(`Unsafe document ID: ${docId}`);
  }
  return docId;
}

export function safeCollectionName(collection: string): string {
  if (!collection || collection === '.' || collection === '..' || /[\\/:*?"<>|\0-\x1f\x7f]/.test(collection)) {
    throw new Error(`Unsafe collection name: ${collection}`);
  }
  return collection;
}

export interface ListOptions<T> {
  filter?: (item: T) => boolean;
  offset?: number;
  limit?: number;
  sort?: (a: T, b: T) => number;
}

export interface ListPage<T> {
  items: T[];
  offset: number;
  limit?: number;
  total: number;
  hasMore: boolean;
}

/** Compatible pagination for every IStateStore implementation. */
export async function listPage<T>(store: IStateStore, collection: string, options: ListOptions<T> = {}): Promise<ListPage<T>> {
  const all = await store.list<T>(collection, options.filter);
  if (options.sort) all.sort(options.sort);
  const offset = Math.max(0, options.offset ?? 0);
  const limit = options.limit === undefined ? undefined : Math.max(0, options.limit);
  const items = limit === undefined ? all.slice(offset) : all.slice(offset, offset + limit);
  return { items, offset, limit, total: all.length, hasMore: offset + items.length < all.length };
}

export class FileStateStore implements IStateStore {
  private dbDir: string;

  constructor(dbDir: string = path.join(process.cwd(), 'db')) {
    this.dbDir = dbDir;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dbDir, { recursive: true });
    const collections = DEFAULT_COLLECTIONS;
    for (const coll of collections) {
      await fs.mkdir(path.join(this.dbDir, coll), { recursive: true });
    }
  }

  private getFilePath(collection: string, docId: string): string {
    return path.join(this.dbDir, safeCollectionName(collection), `${safeDocumentId(docId)}.json`);
  }

  async get<T>(collection: string, docId: string): Promise<T | null> {
    const filePath = this.getFilePath(collection, docId);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content) as T;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      if (error instanceof SyntaxError) {
        console.warn(`[store] Corrupt JSON in ${filePath}, treating as missing`);
        return null;
      }
      throw error;
    }
  }

  async set<T>(collection: string, docId: string, data: T): Promise<void> {
    const filePath = this.getFilePath(collection, docId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const content = JSON.stringify(data, null, 2);
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, content, 'utf8');
    try {
      await fs.rename(tmpPath, filePath);
    } catch (error: any) {
      if (error.code === 'EPERM' || error.code === 'EEXIST' || error.code === 'ENOTEMPTY') {
        try {
          await fs.writeFile(filePath, content, 'utf8');
          await fs.unlink(tmpPath).catch(() => {});
        } catch (fallbackError: any) {
          if (fallbackError.code !== 'ENOENT') {
            throw fallbackError;
          }
        }
      } else {
        throw error;
      }
    }
  }

  async compareAndSwap<T>(collection: string, docId: string, expectedVersion: number, data: T): Promise<boolean> {
    const current = await this.get<{ version?: number }>(collection, docId);
    if (!current) {
      return false;
    }
    if (current.version !== expectedVersion) {
      return false;
    }
    await this.set(collection, docId, data);
    return true;
  }

  async update<T>(collection: string, docId: string, data: Partial<T>): Promise<void> {
    const existing = await this.get<T>(collection, docId);
    if (!existing) {
      throw new Error(`Document ${docId} not found in collection ${collection}`);
    }
    const updated = { ...existing, ...data };
    await this.set(collection, docId, updated);
  }

  async delete(collection: string, docId: string): Promise<void> {
    const filePath = this.getFilePath(collection, docId);
    try {
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async list<T>(collection: string, filter?: (item: T) => boolean): Promise<T[]> {
    const collDir = path.join(this.dbDir, safeCollectionName(collection));
    try {
      const files = await fs.readdir(collDir);
      const results: T[] = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          const docId = path.basename(file, '.json');
          const data = await this.get<T>(collection, docId);
          if (data) {
            if (!filter || filter(data)) {
              results.push(data);
            }
          }
        }
      }
      return results;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}

export class FirestoreStateStore implements IStateStore {
  private firestore: any;

  async initialize(): Promise<void> {
    const { Firestore } = await import('@google-cloud/firestore');
    this.firestore = new Firestore();
  }

  async get<T>(collection: string, docId: string): Promise<T | null> {
    const docRef = this.firestore.collection(safeCollectionName(collection)).doc(safeDocumentId(docId));
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      return null;
    }
    return snapshot.data() as T;
  }

  async set<T>(collection: string, docId: string, data: T): Promise<void> {
    const docRef = this.firestore.collection(safeCollectionName(collection)).doc(safeDocumentId(docId));
    await docRef.set(data);
  }

  async compareAndSwap<T>(collection: string, docId: string, expectedVersion: number, data: T): Promise<boolean> {
    const docRef = this.firestore.collection(safeCollectionName(collection)).doc(safeDocumentId(docId));
    try {
      let success = false;
      await this.firestore.runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists) {
          return;
        }
        const currentData = snapshot.data();
        if (currentData && currentData.version === expectedVersion) {
          transaction.set(docRef, data);
          success = true;
        }
      });
      return success;
    } catch (error) {
      console.error(`[firestore-store] CAS transaction failed:`, error);
      return false;
    }
  }

  async update<T>(collection: string, docId: string, data: Partial<T>): Promise<void> {
    const docRef = this.firestore.collection(safeCollectionName(collection)).doc(safeDocumentId(docId));
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      throw new Error(`Document ${docId} not found in collection ${collection}`);
    }
    await docRef.update(data);
  }

  async delete(collection: string, docId: string): Promise<void> {
    const docRef = this.firestore.collection(safeCollectionName(collection)).doc(safeDocumentId(docId));
    await docRef.delete();
  }

  async list<T>(collection: string, filter?: (item: T) => boolean): Promise<T[]> {
    const querySnapshot = await this.firestore.collection(safeCollectionName(collection)).get();
    const results: T[] = [];
    querySnapshot.forEach((doc: any) => {
      const data = doc.data() as T;
      if (!filter || filter(data)) {
        results.push(data);
      }
    });
    return results;
  }
}

export class PostgresStateStore implements IStateStore {
  private pool: any;

  async initialize(): Promise<void> {
    const pg = await import('pg');
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required for PostgresStateStore');
    }
    this.pool = new pg.Pool({ connectionString });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS opencode_store (
        collection VARCHAR(255) NOT NULL,
        id VARCHAR(255) NOT NULL,
        data JSONB NOT NULL,
        PRIMARY KEY (collection, id)
      );
    `);
  }

  async get<T>(collection: string, docId: string): Promise<T | null> {
    safeCollectionName(collection);
    safeDocumentId(docId);
    const res = await this.pool.query(
      'SELECT data FROM opencode_store WHERE collection = $1 AND id = $2',
      [collection, docId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return res.rows[0].data as T;
  }

  async set<T>(collection: string, docId: string, data: T): Promise<void> {
    safeCollectionName(collection);
    safeDocumentId(docId);
    await this.pool.query(
      `INSERT INTO opencode_store (collection, id, data) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (collection, id) 
       DO UPDATE SET data = EXCLUDED.data`,
      [collection, docId, JSON.stringify(data)]
    );
  }

  async compareAndSwap<T>(collection: string, docId: string, expectedVersion: number, data: T): Promise<boolean> {
    safeCollectionName(collection);
    safeDocumentId(docId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        'SELECT data FROM opencode_store WHERE collection = $1 AND id = $2 FOR UPDATE',
        [collection, docId]
      );
      if (res.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      const currentData = res.rows[0].data;
      if (currentData && currentData.version === expectedVersion) {
        await client.query(
          'UPDATE opencode_store SET data = $1 WHERE collection = $2 AND id = $3',
          [JSON.stringify(data), collection, docId]
        );
        await client.query('COMMIT');
        return true;
      }
      await client.query('ROLLBACK');
      return false;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[postgres-store] CAS transaction failed:', error);
      return false;
    } finally {
      client.release();
    }
  }

  async update<T>(collection: string, docId: string, data: Partial<T>): Promise<void> {
    safeCollectionName(collection);
    safeDocumentId(docId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        'SELECT data FROM opencode_store WHERE collection = $1 AND id = $2 FOR UPDATE',
        [collection, docId]
      );
      if (res.rows.length === 0) {
        throw new Error(`Document ${docId} not found in collection ${collection}`);
      }
      const existing = res.rows[0].data;
      const updated = { ...existing, ...data };
      await client.query(
        'UPDATE opencode_store SET data = $1 WHERE collection = $2 AND id = $3',
        [JSON.stringify(updated), collection, docId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(collection: string, docId: string): Promise<void> {
    safeCollectionName(collection);
    safeDocumentId(docId);
    await this.pool.query(
      'DELETE FROM opencode_store WHERE collection = $1 AND id = $2',
      [collection, docId]
    );
  }

  async list<T>(collection: string, filter?: (item: T) => boolean): Promise<T[]> {
    safeCollectionName(collection);
    const res = await this.pool.query(
      'SELECT data FROM opencode_store WHERE collection = $1',
      [collection]
    );
    const results: T[] = [];
    for (const row of res.rows) {
      const data = row.data as T;
      if (!filter || filter(data)) {
        results.push(data);
      }
    }
    return results;
  }
}
