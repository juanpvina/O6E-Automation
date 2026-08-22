import { describe, it, expect, afterAll, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type {
  Execution,
  IOpenCodeRunner,
  IStateStore,
  IGitProvider,
  ISecretStore,
  Workflow,
  WorkflowStep
} from '@opencode/shared';
import { WorkflowExecutor } from './executor';
import { ProjectQueueManager } from './queue';
import { NoSqlDocumentStore } from './nosql';

class InMemoryStore implements IStateStore {
  private data = new Map<string, Map<string, any>>();

  private coll(collection: string): Map<string, any> {
    if (!this.data.has(collection)) this.data.set(collection, new Map());
    return this.data.get(collection)!;
  }

  async initialize(): Promise<void> {}

  async get<T>(collection: string, docId: string): Promise<T | null> {
    return (this.coll(collection).get(docId) ?? null) as T | null;
  }

  async set<T>(collection: string, docId: string, data: T): Promise<void> {
    this.coll(collection).set(docId, data);
  }

  async update<T>(collection: string, docId: string, data: Partial<T>): Promise<void> {
    const current = this.coll(collection).get(docId);
    if (!current) throw new Error(`Document ${docId} not found in collection ${collection}`);
    this.coll(collection).set(docId, { ...current, ...data });
  }

  async delete(collection: string, docId: string): Promise<void> {
    this.coll(collection).delete(docId);
  }

  async list<T>(collection: string, filter?: (item: T) => boolean): Promise<T[]> {
    const items = Array.from(this.coll(collection).values()) as T[];
    return filter ? items.filter(filter) : items;
  }

  async compareAndSwap<T>(collection: string, docId: string, expectedVersion: number, data: T): Promise<boolean> {
    const current = this.coll(collection).get(docId);
    if (!current) return false;
    if (current.version !== expectedVersion) return false;
    this.coll(collection).set(docId, data);
    return true;
  }
}

const noopGit: IGitProvider = {
  cloneOrFetch: async () => {},
  createBranch: async () => {},
  commitChanges: async () => {},
  push: async () => {},
  createPullRequest: async () => ({ prUrl: 'http://example.com/pr/1', prNumber: 1 })
};

const emptySecrets: ISecretStore = {
  getSecret: async () => null,
  setSecret: async () => {},
  deleteSecret: async () => {}
};

function makeWorkflow(id: string, steps: WorkflowStep[]): Workflow {
  const now = new Date().toISOString();
  return {
    id,
    name: `Workflow ${id}`,
    version: 1,
    isActive: true,
    steps,
    createdAt: now,
    updatedAt: now
  };
}

function step(id: string, type: WorkflowStep['type'], config: Record<string, any>, nextStepIds: string[]): WorkflowStep {
  return { id, type, config, nextStepIds };
}

async function waitForExecution(
  store: IStateStore,
  executionId: string,
  timeoutMs = 10000
): Promise<Execution> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const execution = await store.get<Execution>('executions', executionId);
    if (execution && ['succeeded', 'failed', 'cancelled'].includes(execution.status)) {
      return execution;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Execution ${executionId} did not reach a terminal state within ${timeoutMs}ms`);
}

function makeHarness() {
  const store = new InMemoryStore();
  const queue = new ProjectQueueManager();
  const runner: IOpenCodeRunner = {
    run: async () => {
      throw new Error('runner should not be called by these workflows');
    }
  };
  const executor = new WorkflowExecutor(store, runner, noopGit, emptySecrets, queue);
  return { store, executor };
}

describe('WorkflowExecutor', () => {
  afterAll(async () => {
    await fs.rm(path.join(os.tmpdir(), 'opencode-temp-workspace'), { recursive: true, force: true });
  });

  it('ejecuta un workflow simple y registra stepTimings/statusHistory', async () => {
    const { store, executor } = makeHarness();
    const workflow = makeWorkflow('wf-success', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'shell_test', { command: 'echo ok' }, ['s3']),
      step('s3', 'transform', { template: 'Hello {{triggerPayload.name}}' }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    const executionId = await executor.createExecution(undefined, workflow.id, 'manual', { name: 'World' });
    const execution = await waitForExecution(store, executionId);

    expect(execution.status).toBe('succeeded');
    expect(execution.completedAt).toBeDefined();

    expect(execution.stepTimings).toHaveLength(3);
    expect(execution.stepTimings!.map((t) => t.stepId)).toEqual(['s1', 's2', 's3']);
    for (const t of execution.stepTimings!) {
      expect(t.outcome).toBe('success');
      expect(t.durationMs).toBeGreaterThanOrEqual(0);
    }

    const statuses = execution.statusHistory!.map((h) => h.status);
    expect(statuses[0]).toBe('queued');
    expect(statuses).toContain('running');
    expect(statuses[statuses.length - 1]).toBe('succeeded');

    expect(execution.stepOutputs!['s3'].outputText).toBe('Hello World');
  });

  it('marca la ejecución como failed cuando un paso lanza y lo refleja en statusHistory/stepTimings', async () => {
    const { store, executor } = makeHarness();
    const workflow = makeWorkflow('wf-fail', [
      step('f1', 'trigger', {}, ['f2']),
      step('f2', 'output', { outputType: 'ftp' }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    const executionId = await executor.createExecution(undefined, workflow.id, 'manual', {});
    const execution = await waitForExecution(store, executionId);

    expect(execution.status).toBe('failed');
    expect(execution.errorMessage).toMatch(/not supported/);

    const statuses = execution.statusHistory!.map((h) => h.status);
    expect(statuses[0]).toBe('queued');
    expect(statuses[statuses.length - 1]).toBe('failed');

    const failedStep = execution.stepTimings!.find((t) => t.stepId === 'f2');
    expect(failedStep).toBeDefined();
    expect(failedStep!.outcome).toBe('failed');
    const okStep = execution.stepTimings!.find((t) => t.stepId === 'f1');
    expect(okStep!.outcome).toBe('success');
  });

  it('ejecuta operaciones NoSQL en base de datos local y retorna resultados', async () => {
    const { store, executor } = makeHarness();
    
    // Set up a mock database in the store
    const db = {
      id: 'test_db',
      name: 'Test Database',
      collections: {
        users: {
          u1: { id: 'u1', name: 'Alice', role: 'admin' }
        }
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await store.set('databases', 'test_db', db);

    // 1. Test "find" single doc operation
    const wf1 = makeWorkflow('wf-nosql-find', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'nosql', { databaseId: 'test_db', collection: 'users', operation: 'find', documentId: 'u1' }, [])
    ]);
    await store.set<Workflow>('workflows', wf1.id, wf1);
    const execId1 = await executor.createExecution(undefined, wf1.id, 'manual', {});
    const res1 = await waitForExecution(store, execId1);
    expect(res1.status).toBe('succeeded');
    expect(res1.stepOutputs!['s2'].result.name).toBe('Alice');

    // 2. Test "insert" operation
    const wf2 = makeWorkflow('wf-nosql-insert', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'nosql', { databaseId: 'test_db', collection: 'users', operation: 'insert', documentId: 'u2', data: { name: 'Bob' } }, [])
    ]);
    await store.set<Workflow>('workflows', wf2.id, wf2);
    const execId2 = await executor.createExecution(undefined, wf2.id, 'manual', {});
    const res2 = await waitForExecution(store, execId2);
    expect(res2.status).toBe('succeeded');
    expect(res2.stepOutputs!['s2'].result.id).toBe('u2');
    expect(res2.stepOutputs!['s2'].result.name).toBe('Bob');

    // Verify it was persisted in the store database
    const updatedDb = await store.get<any>('databases', 'test_db');
    expect(updatedDb.collections.users).toEqual({});
    const documents = new NoSqlDocumentStore(store);
    expect(await documents.get('test_db', 'users', 'u1')).toEqual({ id: 'u1', name: 'Alice', role: 'admin' });
    expect(await documents.get('test_db', 'users', 'u2')).toEqual({ id: 'u2', name: 'Bob' });
  });

  it('guarda debugSnapshots y permite rewind & resume', async () => {
    const { store, executor } = makeHarness();
    const workflow = makeWorkflow('wf-rewind', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'shell_test', { command: 'echo ok' }, ['s3']),
      step('s3', 'transform', { template: 'Hello {{triggerPayload.name}}' }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    // First execution
    const executionId = await executor.createExecution(undefined, workflow.id, 'manual', { name: 'Alice' });
    let execution = await waitForExecution(store, executionId);

    expect(execution.status).toBe('succeeded');
    expect(execution.debugSnapshots).toBeDefined();
    expect(execution.debugSnapshots!['s3']).toBeDefined();
    
    // The snapshot at s3 should have s2's output but NOT s3's own output, because it is taken before s3 runs
    expect(execution.debugSnapshots!['s3'].stepOutputs['s2']).toBeDefined();
    expect(execution.debugSnapshots!['s3'].stepOutputs['s3']).toBeUndefined();

    // Now rewind execution to step s3
    const snapshot = execution.debugSnapshots!['s3'];
    execution.stepOutputs = snapshot.stepOutputs;
    execution.currentBranch = snapshot.currentBranch;
    execution.artifacts = snapshot.artifacts;
    if (snapshot.variables) {
      execution.variables = snapshot.variables;
    }

    // Clear stepTimings and agentMetrics from step s3 onwards
    const index = execution.stepTimings?.findIndex(t => t.stepId === 's3') ?? -1;
    expect(index).not.toBe(-1);
    execution.stepTimings = execution.stepTimings?.slice(0, index) || [];
    
    execution.status = 'queued';
    execution.pausedStepId = 's3';
    execution.errorMessage = undefined;

    await store.set<Execution>('executions', executionId, execution);

    // Enqueue for resumption
    await executor.enqueueExistingExecution(executionId, 'default');

    // Wait for the rewound execution to complete
    const finalExec = await waitForExecution(store, executionId);

    expect(finalExec.status).toBe('succeeded');
    expect(finalExec.stepTimings).toHaveLength(3); // s1, s2, s3
    expect(finalExec.stepOutputs!['s3'].outputText).toBe('Hello Alice');
  });

  it('ejecuta un step http_request exitosamente', async () => {
    const { store, executor } = makeHarness();
    const workflow = makeWorkflow('wf-http', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'http_request', {
        url: 'https://api.example.com/test-endpoint',
        method: 'POST',
        headers: { 'X-Custom-Header': 'value-{{triggerPayload.name}}' },
        body: { query: 'hello' },
        authType: 'bearer',
        bearerToken: 'my-token'
      }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    // Mock fetch
    const originalFetch = global.fetch;
    const mockFetch = vi.fn().mockImplementation(async (url, init) => {
      expect(url).toBe('https://api.example.com/test-endpoint');
      expect(init.method).toBe('POST');
      expect(init.headers['X-Custom-Header']).toBe('value-Alice');
      expect(init.headers['Authorization']).toBe('Bearer my-token');
      expect(JSON.parse(init.body)).toEqual({ query: 'hello' });
      return {
        ok: true,
        status: 200,
        headers: {
          forEach: (cb: any) => {
            cb('application/json', 'content-type');
          }
        },
        text: async () => JSON.stringify({ status: 'ok', data: 42 })
      };
    });
    global.fetch = mockFetch as any;

    try {
      const executionId = await executor.createExecution(undefined, workflow.id, 'manual', { name: 'Alice' });
      const execution = await waitForExecution(store, executionId);

      expect(execution.status).toBe('succeeded');
      expect(execution.stepOutputs!['s2'].responseBody).toEqual({ status: 'ok', data: 42 });
      expect(execution.stepOutputs!['s2'].statusCode).toBe(200);
      expect(execution.stepOutputs!['s2'].headers['content-type']).toBe('application/json');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('ejecuta un step code de javascript exitosamente y actualiza variables', async () => {
    const { store, executor } = makeHarness();
    const workflow = makeWorkflow('wf-code-js', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'code', {
        language: 'javascript',
        code: `
          context.variables.testVal = (context.variables.testVal || 0) + 10;
          context.variables.nameUpper = context.triggerPayload.name.toUpperCase();
          42;
        `
      }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    const executionId = await executor.createExecution(undefined, workflow.id, 'manual', { name: 'Alice' });
    const execBefore = await store.get<Execution>('executions', executionId);
    if (execBefore) {
      execBefore.variables = { testVal: 5 };
      await store.set('executions', executionId, execBefore);
    }

    const execution = await waitForExecution(store, executionId);

    expect(execution.status).toBe('succeeded');
    expect(execution.stepOutputs!['s2'].result).toBe(42);
    expect(execution.variables!.testVal).toBe(15);
    expect(execution.variables!.nameUpper).toBe('ALICE');
  });

  it('acepta return en el nivel superior de un step code javascript y persiste el último output', async () => {
    const { store, executor } = makeHarness();
    const workflow = makeWorkflow('wf-code-js-return', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'code', {
        language: 'javascript',
        code: 'return { success: true, payload: context.triggerPayload };'
      }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    const executionId = await executor.createExecution(undefined, workflow.id, 'manual', { name: 'Alice' });
    const execution = await waitForExecution(store, executionId);

    expect(execution.status).toBe('succeeded');
    expect(execution.stepOutputs?.s2?.result).toEqual({ success: true, payload: { name: 'Alice' } });
  });

  it('ejecuta un step code de python exitosamente o falla con error del interprete', async () => {
    const { store, executor } = makeHarness();
    const workflow = makeWorkflow('wf-code-py', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'code', {
        language: 'python',
        code: `
context['variables']['testVal'] = context['variables'].get('testVal', 0) + 20
result = 100
`
      }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    const executionId = await executor.createExecution(undefined, workflow.id, 'manual', {});
    const execBefore = await store.get<Execution>('executions', executionId);
    if (execBefore) {
      execBefore.variables = { testVal: 10 };
      await store.set('executions', executionId, execBefore);
    }

    const execution = await waitForExecution(store, executionId);
    if (execution.status === 'failed') {
      expect(execution.errorMessage).toMatch(/(Python interpreter not found|Failed to execute Python script)/);
    } else {
      expect(execution.status).toBe('succeeded');
      expect(execution.stepOutputs!['s2'].result).toBe(100);
      expect(execution.variables!.testVal).toBe(30);
    }
  });

  it('intercambia JSON tipado entre el contexto y un step code de python', async () => {
    const { store, executor } = makeHarness();
    const workflow = makeWorkflow('wf-code-py-json', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'transform', { template: 'source={{triggerPayload.source}}' }, ['s3']),
      step('s3', 'code', {
        language: 'python',
        code: `
payload = context['triggerPayload']
previous = context['stepOutputs']['s2']['outputText']
context['variables']['summary'] = {
    'source': payload['source'],
    'count': len(payload['items']),
    'previous': previous,
    'enabled': payload['enabled']
}
result = {
    'items': payload['items'],
    'nested': {'ok': True},
    'missing': None
}
`
      }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    const executionId = await executor.createExecution(undefined, workflow.id, 'manual', {
      source: 'webhook',
      items: [1, { name: 'Ada' }],
      enabled: true
    });
    const execution = await waitForExecution(store, executionId);

    if (execution.status === 'failed' && /Python interpreter not found/.test(execution.errorMessage ?? '')) {
      return;
    }

    expect(execution.status).toBe('succeeded');
    expect(execution.stepOutputs!['s3'].result).toEqual({
      items: [1, { name: 'Ada' }],
      nested: { ok: true },
      missing: null
    });
    expect(execution.variables!.summary).toEqual({
      source: 'webhook',
      count: 2,
      previous: 'source=webhook',
      enabled: true
    });
  });

  it('sigue las conexiones nextStepIds y conserva la version del workflow para debug', async () => {
    const { store, executor } = makeHarness();
    const workflow = { ...makeWorkflow('wf-authoring-contract', [
      step('trigger', 'trigger', {}, ['first']),
      step('first', 'transform', { template: 'first' }, ['second']),
      step('second', 'transform', { template: 'second' }, [])
    ]), version: 7 };
    await store.set<Workflow>('workflows', workflow.id, workflow);

    const executionId = await executor.createExecution(undefined, workflow.id, 'manual', {});
    const execution = await waitForExecution(store, executionId);

    expect(execution.status).toBe('succeeded');
    expect(execution.workflowVersion).toBe(7);
    expect(execution.stepTimings!.map((timing) => timing.stepId)).toEqual(['trigger', 'first', 'second']);
    expect(execution.debugSnapshots!['second'].stepOutputs).toEqual({
      trigger: expect.any(Object),
      first: { success: true, outputText: 'first' }
    });
  });

  it('ejecuta un step discord_notify exitosamente', async () => {
    const { store, executor } = makeHarness();
    const workflow = makeWorkflow('wf-discord', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'discord_notify', {
        webhookUrl: 'https://discord.com/api/webhooks/123',
        message: 'Hello {{triggerPayload.name}}'
      }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    const originalFetch = global.fetch;
    const mockFetch = vi.fn().mockImplementation(async (url, init) => {
      expect(url).toBe('https://discord.com/api/webhooks/123');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ content: 'Hello Alice' });
      return {
        ok: true,
        status: 200,
        text: async () => 'ok'
      };
    });
    global.fetch = mockFetch as any;

    try {
      const executionId = await executor.createExecution(undefined, workflow.id, 'manual', { name: 'Alice' });
      const execution = await waitForExecution(store, executionId);
      expect(execution.status).toBe('succeeded');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('ejecuta un step google_sheets de forma simulada si no hay token', async () => {
    const { store, executor } = makeHarness();
    const workflow = makeWorkflow('wf-sheets', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'google_sheets', {
        spreadsheetId: 'sheet123',
        range: 'A1:B2',
        operation: 'append',
        values: [['a', 'b']]
      }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    const executionId = await executor.createExecution(undefined, workflow.id, 'manual', {});
    const execution = await waitForExecution(store, executionId);
    expect(execution.status).toBe('succeeded');
    expect(execution.stepOutputs!['s2'].simulated).toBe(true);
    expect(execution.stepOutputs!['s2'].spreadsheetId).toBe('sheet123');
  });

  it('ejecuta un step code con superpoderes de fetch y opencode.db', async () => {
    const { store, executor } = makeHarness();
    
    // Config a local DB
    const db = {
      id: 'super_db',
      name: 'Super DB',
      collections: {
        items: {
          i1: { id: 'i1', val: 10 }
        }
      }
    };
    await store.set('databases', 'super_db', db);

    const workflow = makeWorkflow('wf-code-superpowers', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'code', {
        language: 'javascript',
        code: `
          (async () => {
            const doc = await opencode.db.find("super_db", "items", "i1");
            const fetchRes = await fetch("https://api.example.com/status");
            const fetchJson = await fetchRes.json();
            
            await opencode.db.insert("super_db", "items", "i2", { val: doc.val + fetchJson.num });
            const allDocs = await opencode.db.find("super_db", "items");
            
            return { allDocs };
          })()
        `
      }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    const originalFetch = global.fetch;
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      expect(url).toBe('https://api.example.com/status');
      return {
        ok: true,
        status: 200,
        json: async () => ({ num: 5 })
      };
    });
    global.fetch = mockFetch as any;

    try {
      const executionId = await executor.createExecution(undefined, workflow.id, 'manual', {});
      const execution = await waitForExecution(store, executionId);
      expect(execution.status).toBe('succeeded');
      
      const allDocs = execution.stepOutputs!['s2'].result.allDocs;
      expect(allDocs).toHaveLength(2);
      expect(allDocs.find((d: any) => d.id === 'i2').val).toBe(15);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('ejecuta un nodo json_parser, selecciona una ruta y mapea rows', async () => {
    const { store, executor } = makeHarness();
    const workflow = makeWorkflow('wf-json-parser', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'json_parser', {
        inputExpr: '{{context.triggerPayload}}',
        operation: 'rows',
        path: '$.items',
        mapping: { identifier: 'id', label: 'profile.name' }
      }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    const executionId = await executor.createExecution(undefined, workflow.id, 'manual', {
      items: [{ id: 1, profile: { name: 'Ada' } }, { id: 2, profile: { name: 'Grace' } }]
    });
    const execution = await waitForExecution(store, executionId);

    expect(execution.status).toBe('succeeded');
    expect(execution.stepOutputs!['s2']).toMatchObject({
      data: [{ id: 1, profile: { name: 'Ada' } }, { id: 2, profile: { name: 'Grace' } }],
      rows: [{ identifier: 1, label: 'Ada' }, { identifier: 2, label: 'Grace' }],
      count: 2
    });
  });

  it('normalizer delega parserMode/parserInput al JSON parser', async () => {
    const { store, executor } = makeHarness();
    const workflow = makeWorkflow('wf-normalizer-parser', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'normalizer', { parserMode: 'extract', parserInput: '{{context.triggerPayload}}', path: 'payload.value' }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    const executionId = await executor.createExecution(undefined, workflow.id, 'manual', { payload: { value: 7 } });
    const execution = await waitForExecution(store, executionId);

    expect(execution.status).toBe('succeeded');
    expect(execution.stepOutputs!['s2'].result).toBe(7);
  });

  it('ejecuta Python inline con stdin JSON y conserva variables/stdout/stderr', async () => {
    const { store, executor } = makeHarness();
    const workflow = makeWorkflow('wf-python-node', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'python', {
        code: `
context['variables']['answer'] = context['triggerPayload']['value'] + 1
print('diagnostic', file=sys.stderr)
result = {'received': context['triggerPayload']['value']}
`,
        timeoutMs: 5000
      }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, workflow);

    const executionId = await executor.createExecution(undefined, workflow.id, 'manual', { value: 41 });
    const execution = await waitForExecution(store, executionId);
    if (execution.status === 'failed' && /Python interpreter not found/.test(execution.errorMessage ?? '')) return;

    expect(execution.status).toBe('succeeded');
    expect(execution.variables!.answer).toBe(42);
    expect(execution.stepOutputs!['s2'].result).toEqual({ received: 41 });
    expect(execution.stepOutputs!['s2'].stderr).toContain('diagnostic');
  });

  it('rechaza scripts Python fuera del workspace antes de ejecutarlos', async () => {
    const { store, executor } = makeHarness();
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-python-test-'));
    const project = {
      id: 'python-isolation-project', name: 'Python isolation', localPath: workspace,
      gitRemoteUrl: '', baseBranch: 'main', allowedCommands: [],
      policy: { maxExecutionTimeSeconds: 30, concurrencyMode: 'serialize' as const, requireApprovalForDestructiveActions: false },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    await store.set('projects', project.id, project);
    const workflow = makeWorkflow('wf-python-isolation', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'python', { source: 'file', filePath: '../outside.py' }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, { ...workflow, projectId: project.id });

    const executionId = await executor.createExecution(project.id, workflow.id, 'manual', {});
    const execution = await waitForExecution(store, executionId);
    await fs.rm(workspace, { recursive: true, force: true });

    expect(execution.status).toBe('failed');
    expect(execution.errorMessage).toMatch(/Security Violation/);
  });

  it('rechaza comandos que solo comparten un prefijo ambiguo con el allowlist', async () => {
    const { store, executor } = makeHarness();
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-shell-test-'));
    const project = {
      id: 'shell-isolation-project', name: 'Shell isolation', localPath: workspace,
      gitRemoteUrl: '', baseBranch: 'main', allowedCommands: ['echo ok'],
      policy: { maxExecutionTimeSeconds: 30, concurrencyMode: 'serialize' as const, requireApprovalForDestructiveActions: false },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    await store.set('projects', project.id, project);
    const workflow = makeWorkflow('wf-shell-authorization', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'shell_test', { projectId: project.id, command: 'echo okay' }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, { ...workflow, projectId: project.id });

    const execution = await waitForExecution(store, await executor.createExecution(project.id, workflow.id, 'manual', {}));
    await fs.rm(workspace, { recursive: true, force: true });

    expect(execution.status).toBe('failed');
    expect(execution.errorMessage).toMatch(/not pre-authorized/);
  });

  it('rechaza outputs en un workspace hermano aunque comparta el prefijo del workspace', async () => {
    const { store, executor } = makeHarness();
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-output-test-'));
    const sibling = `${workspace}-sibling`;
    await fs.mkdir(sibling, { recursive: true });
    const project = {
      id: 'output-isolation-project', name: 'Output isolation', localPath: workspace,
      gitRemoteUrl: '', baseBranch: 'main', allowedCommands: [],
      policy: { maxExecutionTimeSeconds: 30, concurrencyMode: 'serialize' as const, requireApprovalForDestructiveActions: false },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    await store.set('projects', project.id, project);
    const workflow = makeWorkflow('wf-output-isolation', [
      step('s1', 'trigger', {}, ['s2']),
      step('s2', 'output', { outputType: 'file', filePath: `../${path.basename(sibling)}/outside.txt`, data: 'nope' }, [])
    ]);
    await store.set<Workflow>('workflows', workflow.id, { ...workflow, projectId: project.id });

    const execution = await waitForExecution(store, await executor.createExecution(project.id, workflow.id, 'manual', {}));
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(sibling, { recursive: true, force: true });

    expect(execution.status).toBe('failed');
    expect(execution.errorMessage).toMatch(/Security Violation/);
  });
});
