import { IStateStore } from '@opencode/shared';
import { safeCollectionName, safeDocumentId } from './store';

/** Stores each user document independently instead of rewriting one database blob. */
export class NoSqlDocumentStore {
  constructor(private readonly store: IStateStore) {}

  private async migrateCollection(databaseId: string, collection: string): Promise<void> {
    const db = await this.store.get<any>('databases', databaseId);
    const embedded = db?.collections?.[collection];
    if (!embedded || typeof embedded !== 'object' || Array.isArray(embedded) || Object.keys(embedded).length === 0) return;

    const collectionName = this.collectionName(databaseId, collection);
    for (const [key, value] of Object.entries(embedded)) {
      const document = value && typeof value === 'object' ? { ...(value as any) } : { value };
      const id = safeDocumentId(String(document.id || key));
      document.id = id;
      if (!(await this.store.get(collectionName, id))) {
        await this.store.set(collectionName, id, document);
      }
    }

    // Keep database records as metadata only. Documents live in their own collection.
    db.collections[collection] = {};
    db.updatedAt = new Date().toISOString();
    await this.store.set('databases', databaseId, db);
  }

  private async migrateDatabase(databaseId: string): Promise<void> {
    const db = await this.store.get<any>('databases', databaseId);
    for (const collection of Object.keys(db?.collections || {})) {
      await this.migrateCollection(databaseId, collection);
    }
  }

  private collectionName(databaseId: string, collection: string): string {
    return safeCollectionName(`nosql_${safeDocumentId(databaseId)}_${safeCollectionName(collection)}`);
  }

  async get<T>(databaseId: string, collection: string, docId: string): Promise<T | null> {
    await this.migrateCollection(databaseId, collection);
    return this.store.get<T>(this.collectionName(databaseId, collection), safeDocumentId(docId));
  }

  async upsert<T extends { id: string }>(databaseId: string, collection: string, document: T): Promise<T> {
    await this.migrateCollection(databaseId, collection);
    const id = safeDocumentId(document.id);
    const existing = await this.get<T>(databaseId, collection, id);
    const merged = { ...existing, ...document, id } as T;
    await this.store.set(this.collectionName(databaseId, collection), id, merged);
    return merged;
  }

  async list<T>(databaseId: string, collection: string): Promise<T[]> {
    await this.migrateCollection(databaseId, collection);
    return this.store.list<T>(this.collectionName(databaseId, collection));
  }

  async delete(databaseId: string, collection: string, docId: string): Promise<void> {
    await this.migrateCollection(databaseId, collection);
    await this.store.delete(this.collectionName(databaseId, collection), safeDocumentId(docId));
  }

  async deleteCollection(databaseId: string, collection: string): Promise<void> {
    await this.migrateCollection(databaseId, collection);
    const collectionName = this.collectionName(databaseId, collection);
    const documents = await this.store.list<{ id: string }>(collectionName);
    await Promise.all(documents.map((document) => this.store.delete(collectionName, safeDocumentId(document.id))));
  }

  async deleteDatabase(databaseId: string): Promise<void> {
    await this.migrateDatabase(databaseId);
    const db = await this.store.get<any>('databases', databaseId);
    for (const collection of Object.keys(db?.collections || {})) {
      await this.deleteCollection(databaseId, collection);
    }
  }
}
