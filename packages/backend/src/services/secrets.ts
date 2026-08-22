import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ISecretStore, IStateStore, EncryptedSecret } from '@opencode/shared';

export class AESSecretStore implements ISecretStore {
  private store: IStateStore;
  private keyPromise: Promise<Buffer>;

  constructor(store: IStateStore) {
    this.store = store;
    this.keyPromise = this.resolveKey();
  }

  private async resolveKey(): Promise<Buffer> {
    const envKey = process.env.ENCRYPTION_KEY;
    if (envKey) {
      // Use SHA256 to ensure key is 32 bytes
      return crypto.createHash('sha256').update(envKey).digest();
    }
    
    // Fallback: Read/Create local secret key file
    const keyPath = path.join(process.cwd(), '.secret_key');
    try {
      const storedKey = await fs.readFile(keyPath);
      if (storedKey.length === 32) {
        return storedKey;
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    // Generate new key and save it
    const newKey = crypto.randomBytes(32);
    await fs.writeFile(keyPath, newKey, { mode: 0o600 });
    // Best effort on platforms where chmod is supported; the key must not be world-readable.
    try {
      await fs.chmod(keyPath, 0o600);
    } catch {
      // Windows and some mounted filesystems do not expose POSIX permissions.
    }
    return newKey;
  }

  private async getEncryptionKey(): Promise<Buffer> {
    return this.keyPromise;
  }

  async getSecret(projectId: string, key: string): Promise<string | null> {
    const docId = `${projectId}_${key}`;
    const encryptedSecret = await this.store.get<EncryptedSecret>('secrets', docId);
    if (!encryptedSecret) {
      return null;
    }

    const keyBuffer = await this.getEncryptionKey();
    if (!/^[0-9a-f]+$/i.test(encryptedSecret.iv) || encryptedSecret.iv.length !== 24 ||
      !/^[0-9a-f]+$/i.test(encryptedSecret.tag) || encryptedSecret.tag.length !== 32 ||
      !/^[0-9a-f]*$/i.test(encryptedSecret.encryptedValue)) {
      throw new Error('Stored secret has invalid encrypted data');
    }
    const iv = Buffer.from(encryptedSecret.iv, 'hex');
    const tag = Buffer.from(encryptedSecret.tag, 'hex');
    const encryptedText = Buffer.from(encryptedSecret.encryptedValue, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    try {
      return decrypted.toString('utf8');
    } finally {
      // Do not retain plaintext in intermediate Buffer instances after returning it.
      decrypted.fill(0);
      encryptedText.fill(0);
      iv.fill(0);
      tag.fill(0);
    }
  }

  async setSecret(projectId: string, key: string, value: string): Promise<void> {
    const docId = `${projectId}_${key}`;
    const keyBuffer = await this.getEncryptionKey();
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
    let encrypted = cipher.update(value, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const tag = cipher.getAuthTag();

    const data: EncryptedSecret = {
      id: docId,
      projectId,
      encryptedValue: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      updatedAt: new Date().toISOString(),
    };

    try {
      await this.store.set<EncryptedSecret>('secrets', docId, data);
    } finally {
      encrypted.fill(0);
      iv.fill(0);
      tag.fill(0);
    }
  }

  async deleteSecret(projectId: string, key: string): Promise<void> {
    const docId = `${projectId}_${key}`;
    await this.store.delete('secrets', docId);
  }
}

export class GcpSecretManagerSecretStore implements ISecretStore {
  private client: any = null;
  private gcpProjectId: string;

  constructor() {
    this.gcpProjectId = process.env.GCP_PROJECT_ID || '';
  }

  private async getClient() {
    if (!this.client) {
      if (!this.gcpProjectId) {
        throw new Error('GCP_PROJECT_ID environment variable is required for GcpSecretManagerSecretStore');
      }
      const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
      this.client = new SecretManagerServiceClient();
    }
    return this.client;
  }

  private getSecretId(projectId: string, key: string): string {
    const rawName = `opencode-${projectId}-${key}`;
    return rawName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  }

  async getSecret(projectId: string, key: string): Promise<string | null> {
    const client = await this.getClient();
    const secretId = this.getSecretId(projectId, key);
    const name = `projects/${this.gcpProjectId}/secrets/${secretId}/versions/latest`;
    try {
      const [version] = await client.accessSecretVersion({ name });
      if (version.payload && version.payload.data) {
        return version.payload.data.toString('utf8');
      }
      return null;
    } catch (error: any) {
      if (error.code === 5 || error.status === 'NOT_FOUND' || error.message?.includes('NOT_FOUND') || error.message?.includes('Not found')) {
        return null;
      }
      throw error;
    }
  }

  async setSecret(projectId: string, key: string, value: string): Promise<void> {
    const client = await this.getClient();
    const secretId = this.getSecretId(projectId, key);
    const parent = `projects/${this.gcpProjectId}`;
    const secretPath = `projects/${this.gcpProjectId}/secrets/${secretId}`;

    try {
      await client.getSecret({ name: secretPath });
    } catch (error: any) {
      if (error.code === 5 || error.status === 'NOT_FOUND' || error.message?.includes('NOT_FOUND') || error.message?.includes('Not found')) {
        await client.createSecret({
          parent,
          secretId,
          secret: {
            replication: {
              automatic: {},
            },
          },
        });
      } else {
        throw error;
      }
    }

    await client.addSecretVersion({
      parent: secretPath,
      payload: {
        data: Buffer.from(value, 'utf8'),
      },
    });
  }

  async deleteSecret(projectId: string, key: string): Promise<void> {
    const client = await this.getClient();
    const secretId = this.getSecretId(projectId, key);
    const secretPath = `projects/${this.gcpProjectId}/secrets/${secretId}`;
    try {
      await client.deleteSecret({ name: secretPath });
    } catch (error: any) {
      if (error.code === 5 || error.status === 'NOT_FOUND' || error.message?.includes('NOT_FOUND') || error.message?.includes('Not found')) {
        return;
      }
      throw error;
    }
  }
}
