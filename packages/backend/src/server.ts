import express from 'express';
import cors from 'cors';
import * as crypto from 'crypto';
import { FileStateStore, FirestoreStateStore, PostgresStateStore } from './services/store';
import { ExecutionStateStore } from './services/execution-persistence';
import { AESSecretStore, GcpSecretManagerSecretStore } from './services/secrets';
import { CLIOpenCodeRunner, RemoteOpenCodeRunner } from './services/runner';
import { LocalGitProvider, GitLabProvider, BitbucketProvider } from './services/git';
import { ProjectQueueManager } from './services/queue';
import { WorkflowExecutor } from './services/executor';
import { NoSqlDocumentStore } from './services/nosql';
import { CronScheduler } from './services/scheduler';
import { Project, Connection, Workflow, CronSchedule, Execution, StepEvent, EncryptedSecret, IStateStore, ISecretStore, IOpenCodeRunner, IGitProvider, validateWorkflow } from '@opencode/shared';

export async function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({
    limit: process.env.ORCHESTRATOR_JSON_LIMIT || '1mb',
    verify: (req: any, _res, buf) => {
      // Keep the exact bounded bytes for HMAC verification. Do not rebuild the
      // signed payload from parsed JSON, which changes whitespace/key order.
      req.rawBody = Buffer.from(buf);
    }
  }));

  // Silence Chrome DevTools automatic requests
  app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req, res) => {
    res.status(204).end();
  });

  // --- API Authentication Middleware (optional) ---
  // Protects all /api/* routes when ORCHESTRATOR_API_TOKEN is set.
  // The /webhooks/:connectionId route is intentionally excluded (it has its own auth).
  const apiAuthMiddleware: express.RequestHandler = (req, res, next) => {
    const configuredToken = process.env.ORCHESTRATOR_API_TOKEN;
    if (!configuredToken) {
      // API remains open (retrocompatible with localhost).
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const provided = authHeader.substring(7);
    const providedBuf = Buffer.from(provided, 'utf8');
    const configuredBuf = Buffer.from(configuredToken, 'utf8');

    if (
      providedBuf.length !== configuredBuf.length ||
      !crypto.timingSafeEqual(providedBuf, configuredBuf)
    ) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
  };
  app.use('/api', apiAuthMiddleware);

  // 1. Initialize Services
  let baseStore: IStateStore;
  const storeType = process.env.STORE_TYPE || 'file';
  if (storeType === 'firestore') {
    baseStore = new FirestoreStateStore();
  } else if (storeType === 'postgres') {
    baseStore = new PostgresStateStore();
  } else {
    baseStore = new FileStateStore();
  }
  await baseStore.initialize();
  const store: IStateStore = new ExecutionStateStore(baseStore);
  const noSqlDocuments = new NoSqlDocumentStore(store);

  let secretStore: ISecretStore;
  const secretStoreType = process.env.SECRET_STORE_TYPE || 'aes';
  if (secretStoreType === 'gcp_secret_manager') {
    secretStore = new GcpSecretManagerSecretStore();
  } else {
    secretStore = new AESSecretStore(store);
  }

  let runner: IOpenCodeRunner;
  const runnerType = process.env.RUNNER_TYPE || 'cli';
  if (runnerType === 'remote') {
    runner = new RemoteOpenCodeRunner();
  } else {
    runner = new CLIOpenCodeRunner();
  }

  let git: IGitProvider;
  const gitProviderType = process.env.GIT_PROVIDER_TYPE || 'local';
  if (gitProviderType === 'gitlab') {
    git = new GitLabProvider();
  } else if (gitProviderType === 'bitbucket') {
    git = new BitbucketProvider();
  } else {
    git = new LocalGitProvider();
  }

  const queue = new ProjectQueueManager();
  
  // 2. Initialize Workflow Executor
  const executor = new WorkflowExecutor(store, runner, git, secretStore, queue);

  // 3. Initialize Cron Scheduler
  const scheduler = new CronScheduler(store, async (projectId, workflowId, triggerType, payload) => {
    return await executor.createExecution(projectId, workflowId, triggerType, payload);
  });
  await scheduler.start();

  // Helper: Hash Bearer Token
  const hashToken = (token: string): string => {
    return crypto.createHash('sha256').update(token).digest('hex');
  };

  // Helper: Synchronize Workflow triggers (schedules and webhook connections)
  const syncWorkflowTriggers = async (workflow: Workflow): Promise<Record<string, string>> => {
    const newWebhookTokens: Record<string, string> = {};

    // --- 1. Sync Cron Schedules ---
    const currentCronIds = new Set(
      (workflow.steps || [])
        .filter(s => s.type === 'trigger' && s.config?.triggerType === 'cron')
        .map(s => `cron-${workflow.id}-${s.id}`)
    );

    // Remove old schedules from active scheduler and store
    try {
      const allSchedules = await store.list<CronSchedule>('schedules');
      const oldSchedules = allSchedules.filter(
        s => s.workflowId === workflow.id && !currentCronIds.has(s.id)
      );
      for (const oldSched of oldSchedules) {
        scheduler.unregister(oldSched.id);
        await store.delete('schedules', oldSched.id);
      }
    } catch (err) {
      console.error('Error cleaning up old cron schedules:', err);
    }

    // Create or update current schedules
    const cronSteps = (workflow.steps || []).filter(s => s.type === 'trigger' && s.config?.triggerType === 'cron');
    for (const step of cronSteps) {
      const scheduleId = `cron-${workflow.id}-${step.id}`;
      try {
        const existing = await store.get<CronSchedule>('schedules', scheduleId);
        const scheduleData: CronSchedule = {
          id: scheduleId,
          name: step.config?.name || `${workflow.name} Cron Trigger`,
          projectId: workflow.projectId || '',
          workflowId: workflow.id,
          cronExpression: step.config?.cronExpression || '0 9 * * 1-5',
          timezone: step.config?.timezone || 'America/Bogota',
          isActive: workflow.isActive && (step.config?.isActive ?? true),
          lastRunAt: existing?.lastRunAt,
          nextRunAt: existing?.nextRunAt
        };
        await store.set('schedules', scheduleId, scheduleData);
        if (scheduleData.isActive) {
          scheduler.register(scheduleData);
        } else {
          scheduler.unregister(scheduleId);
        }
      } catch (err) {
        console.error(`Error syncing cron schedule ${scheduleId}:`, err);
      }
    }

    // --- 2. Sync Webhook Connections ---
    const currentWebhookIds = new Set(
      (workflow.steps || [])
        .filter(s => s.type === 'trigger' && s.config?.triggerType === 'webhook')
        .map(s => `webhook-${workflow.id}-${s.id}`)
    );

    // Remove old connections
    try {
      const allConnections = await store.list<Connection>('connections');
      const oldConnections = allConnections.filter(
        c => c.workflowId === workflow.id && !currentWebhookIds.has(c.id)
      );
      for (const oldConn of oldConnections) {
        await store.delete('connections', oldConn.id);
      }
    } catch (err) {
      console.error('Error cleaning up old webhook connections:', err);
    }

    // Create or update connections
    const webhookSteps = (workflow.steps || []).filter(s => s.type === 'trigger' && s.config?.triggerType === 'webhook');
    for (const step of webhookSteps) {
      const connectionId = `webhook-${workflow.id}-${step.id}`;
      try {
        const existingConn = await store.get<Connection>('connections', connectionId);
        const authType = step.config?.authType || existingConn?.authType || 'bearer';
        const idempotencyTtlMs = step.config?.idempotencyTtlMs;

        // Full re-creation when there is no existing connection or credentials are regenerated
        if (!existingConn || step.config?.regenerateToken || step.config?.regenerateSecret) {
          if (authType === 'hmac') {
            const rawSecret = crypto.randomBytes(32).toString('hex');
            const connection: Connection = {
              id: connectionId,
              name: step.config?.name || `${workflow.name} Webhook Trigger`,
              projectId: workflow.projectId || '',
              workflowId: workflow.id,
              tokenHash: '',
              authType,
              secretHash: hashToken(rawSecret),
              idempotencyTtlMs,
              createdAt: existingConn?.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            await secretStore.setSecret(connectionId, 'webhook_secret', rawSecret);
            executor.invalidateProjectSecrets(connectionId);
            await store.set('connections', connectionId, connection);
            newWebhookTokens[step.id] = rawSecret;
          } else {
            const rawToken = crypto.randomBytes(32).toString('hex');
            const connection: Connection = {
              id: connectionId,
              name: step.config?.name || `${workflow.name} Webhook Trigger`,
              projectId: workflow.projectId || '',
              workflowId: workflow.id,
              tokenHash: hashToken(rawToken),
              authType,
              idempotencyTtlMs,
              createdAt: existingConn?.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            await store.set('connections', connectionId, connection);
            newWebhookTokens[step.id] = rawToken;
          }

          // Clear the regenerate flags from step config
          if (step.config) {
            delete step.config.regenerateToken;
            delete step.config.regenerateSecret;
          }
        } else if (authType === 'hmac' && !existingConn.secretHash) {
          // Transitioning to HMAC on an existing connection: generate the shared secret now (shown once)
          const rawSecret = crypto.randomBytes(32).toString('hex');
          await secretStore.setSecret(connectionId, 'webhook_secret', rawSecret);
          executor.invalidateProjectSecrets(connectionId);
          await store.update<Connection>('connections', connectionId, {
            authType,
            secretHash: hashToken(rawSecret),
            idempotencyTtlMs,
            updatedAt: new Date().toISOString()
          });
          newWebhookTokens[step.id] = rawSecret;
        } else {
          await store.update<Connection>('connections', connectionId, {
            name: step.config?.name || `${workflow.name} Webhook Trigger`,
            projectId: workflow.projectId || '',
            workflowId: workflow.id,
            authType,
            idempotencyTtlMs,
            updatedAt: new Date().toISOString()
          });
        }
      } catch (err) {
        console.error(`Error syncing webhook connection ${connectionId}:`, err);
      }
    }

    return newWebhookTokens;
  };

  // --- Webhook Endpoint ---
  // In-memory nonce tracking per connection for HMAC replay protection.
  const seenNonces = new Map<string, Map<string, number>>();
  const maxNonceConnections = 1000;
  const maxNoncesPerConnection = 10000;

  app.post('/webhooks/:connectionId', async (req, res) => {
    const { connectionId } = req.params;

    try {
      const connection = await store.get<Connection>('connections', connectionId);
      if (!connection) {
        return res.status(404).json({ error: 'Connection not found.' });
      }

      const authType = connection.authType || 'bearer';

      if (authType === 'hmac') {
        // --- HMAC-SHA256 authentication ---
        const xSignature = req.headers['x-signature'];
        const xTimestamp = req.headers['x-timestamp'];
        const xNonce = req.headers['x-nonce'];

        if (typeof xSignature !== 'string' || typeof xTimestamp !== 'string' || typeof xNonce !== 'string') {
          return res.status(401).json({ error: 'Missing HMAC headers: X-Signature, X-Timestamp and X-Nonce are required.' });
        }
        if (xNonce.length === 0 || xNonce.length > 256) {
          return res.status(401).json({ error: 'Invalid nonce.' });
        }

        // (a) Reject requests outside the ±5 minute timestamp window
        const now = Date.now();
        const timestampMs = parseInt(xTimestamp, 10);
        if (isNaN(timestampMs) || Math.abs(now - timestampMs) > 5 * 60 * 1000) {
          return res.status(401).json({ error: 'Request timestamp is outside the allowed window.' });
        }

        // (b) Replay protection: reject reused nonces per connection (with TTL cleanup)
        const nonceTtlMs = connection.idempotencyTtlMs || 24 * 60 * 60 * 1000;
        let nonces = seenNonces.get(connectionId);
        if (!nonces) {
          nonces = new Map<string, number>();
          seenNonces.set(connectionId, nonces);
        }
        for (const [nonce, seenAt] of nonces.entries()) {
          if (now - seenAt > nonceTtlMs) nonces.delete(nonce);
        }
        if (nonces.size >= maxNoncesPerConnection && !nonces.has(xNonce)) {
          const oldest = nonces.keys().next().value;
          if (oldest) nonces.delete(oldest);
        }
        if (nonces.has(xNonce)) {
          return res.status(409).json({ error: 'Duplicate nonce detected.' });
        }
        nonces.set(xNonce, now);
        if (seenNonces.size > maxNonceConnections) {
          const firstConnection = seenNonces.keys().next().value;
          if (firstConnection && firstConnection !== connectionId) seenNonces.delete(firstConnection);
        }

        // (c) Verify HMAC-SHA256 signature over the raw body using the stored (encrypted) secret
        const secret = await secretStore.getSecret(connectionId, 'webhook_secret');
        if (!secret) {
          return res.status(401).json({ error: 'Webhook secret is not configured.' });
        }
        const rawBody = (req as any).rawBody;
        if (!Buffer.isBuffer(rawBody)) {
          return res.status(400).json({ error: 'Raw request body is unavailable.' });
        }
        const expectedSig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        const receivedSig = xSignature.startsWith('sha256=') ? xSignature.substring(7) : xSignature;

        const expectedBuf = Buffer.from(expectedSig, 'hex');
        const receivedBuf = Buffer.from(receivedSig, 'hex');
        const sigValid = expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf);
        if (!sigValid) {
          return res.status(401).json({ error: 'Invalid HMAC signature.' });
        }
      } else {
        // --- Bearer token authentication (default, retrocompatible) ---
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
        }

        const token = authHeader.substring(7);
        const hashed = hashToken(token);
        if (connection.tokenHash !== hashed) {
          return res.status(401).json({ error: 'Unauthorized token.' });
        }
      }

      // --- Idempotency key ---
      let idempotencyKey: string;
      const xIdempotencyKey = req.headers['x-idempotency-key'];
      if (typeof xIdempotencyKey === 'string' && xIdempotencyKey.length > 0) {
        idempotencyKey = xIdempotencyKey;
      } else {
        idempotencyKey = crypto.createHash('sha256').update(connectionId + ':' + JSON.stringify(req.body)).digest('hex');
      }

      // Trigger workflow
      const executionId = await executor.createExecution(
        connection.projectId,
        connection.workflowId,
        'webhook',
        req.body,
        { idempotencyKey }
      );

      return res.status(202).json({ message: 'Execution enqueued.', executionId });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  });

  // --- Projects API ---
  app.get('/api/projects', async (req, res) => {
    const list = await store.list<Project>('projects');
    res.json(list);
  });

  app.get('/api/projects/:id', async (req, res) => {
    const item = await store.get<Project>('projects', req.params.id);
    if (!item) return res.status(404).json({ error: 'Project not found' });
    res.json(item);
  });

  app.post('/api/projects', async (req, res) => {
    const project: Project = {
      ...req.body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await store.set('projects', project.id, project);
    res.status(201).json(project);
  });

  app.put('/api/projects/:id', async (req, res) => {
    await store.update<Project>('projects', req.params.id, {
      ...req.body,
      updatedAt: new Date().toISOString()
    });
    const updated = await store.get('projects', req.params.id);
    res.json(updated);
  });

  app.delete('/api/projects/:id', async (req, res) => {
    await store.delete('projects', req.params.id);
    res.status(204).end();
  });

  // --- Project Secrets API ---
  app.post('/api/projects/:projectId/secrets', async (req, res) => {
    const { projectId } = req.params;
    const { key, value } = req.body;
    if (!key || !value) {
      return res.status(400).json({ error: 'Key and value are required.' });
    }
    await secretStore.setSecret(projectId, key, value);
    executor.invalidateProjectSecrets(projectId);
    res.status(200).json({ message: 'Secret configured successfully.' });
  });

  app.delete('/api/projects/:projectId/secrets/:key', async (req, res) => {
    const { projectId, key } = req.params;
    await secretStore.deleteSecret(projectId, key);
    executor.invalidateProjectSecrets(projectId);
    res.status(204).end();
  });

  // --- Connections API ---
  app.get('/api/connections', async (req, res) => {
    const list = await store.list<Connection>('connections');
    // Hide token and secret hashes in lists
    const cleanList = list.map(c => ({ ...c, tokenHash: '[HIDDEN]', secretHash: c.secretHash ? '[HIDDEN]' : undefined }));
    res.json(cleanList);
  });

  app.post('/api/connections', async (req, res) => {
    const authType = req.body.authType || 'bearer';
    const idempotencyTtlMs = req.body.idempotencyTtlMs;
    const connection: Connection = {
      id: req.body.id || crypto.randomUUID(),
      name: req.body.name,
      projectId: req.body.projectId,
      workflowId: req.body.workflowId,
      tokenHash: '',
      authType,
      idempotencyTtlMs,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (authType === 'hmac') {
      const rawSecret = crypto.randomBytes(32).toString('hex');
      connection.secretHash = hashToken(rawSecret);
      await secretStore.setSecret(connection.id, 'webhook_secret', rawSecret);
      executor.invalidateProjectSecrets(connection.id);
      await store.set('connections', connection.id, connection);
      return res.status(201).json({ ...connection, rawSecret });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    connection.tokenHash = hashToken(rawToken);
    await store.set('connections', connection.id, connection);
    res.status(201).json({ ...connection, rawToken });
  });

  app.delete('/api/connections/:id', async (req, res) => {
    await store.delete('connections', req.params.id);
    res.status(204).end();
  });

  // --- Workflows API ---
  app.get('/api/workflows', async (req, res) => {
    const list = await store.list<Workflow>('workflows');
    res.json(list);
  });

  app.get('/api/workflows/:id', async (req, res) => {
    const item = await store.get<Workflow>('workflows', req.params.id);
    if (!item) return res.status(404).json({ error: 'Workflow not found' });
    res.json(item);
  });

  app.post('/api/workflows', async (req, res) => {
    const workflow: Workflow = {
      ...req.body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const validation = validateWorkflow(workflow);
    if (validation.errors.length > 0) {
      return res.status(400).json({ error: 'El workflow contiene errores estructurales.', validation });
    }
    const newWebhookTokens = await syncWorkflowTriggers(workflow);
    await store.set('workflows', workflow.id, workflow);
    res.status(201).json({
      ...workflow,
      newWebhookTokens,
      validation: { errors: [], warnings: validation.warnings }
    });
  });

  app.put('/api/workflows/:id', async (req, res) => {
    const workflow: Workflow = {
      ...req.body,
      id: req.params.id,
      updatedAt: new Date().toISOString()
    };
    const validation = validateWorkflow(workflow);
    if (validation.errors.length > 0) {
      return res.status(400).json({ error: 'El workflow contiene errores estructurales.', validation });
    }
    const newWebhookTokens = await syncWorkflowTriggers(workflow);
    await store.set('workflows', req.params.id, workflow);
    res.json({
      ...workflow,
      newWebhookTokens,
      validation: { errors: [], warnings: validation.warnings }
    });
  });

  app.delete('/api/workflows/:id', async (req, res) => {
    const workflowId = req.params.id;
    try {
      const allSchedules = await store.list<CronSchedule>('schedules');
      const wfSchedules = allSchedules.filter(s => s.workflowId === workflowId);
      for (const sched of wfSchedules) {
        scheduler.unregister(sched.id);
        await store.delete('schedules', sched.id);
      }
      
      const allConnections = await store.list<Connection>('connections');
      const wfConnections = allConnections.filter(c => c.workflowId === workflowId);
      for (const conn of wfConnections) {
        await store.delete('connections', conn.id);
      }
    } catch (err) {
      console.error('Error cleaning up deleted workflow triggers:', err);
    }
    await store.delete('workflows', req.params.id);
    res.status(204).end();
  });

  // --- Schedules API ---
  app.get('/api/schedules', async (req, res) => {
    const list = await store.list<CronSchedule>('schedules');
    res.json(list);
  });

  app.post('/api/schedules', async (req, res) => {
    const schedule: CronSchedule = {
      ...req.body,
      id: req.body.id || crypto.randomUUID(),
      isActive: req.body.isActive ?? true
    };
    await store.set('schedules', schedule.id, schedule);
    if (schedule.isActive) {
      scheduler.register(schedule);
    }
    res.status(201).json(schedule);
  });

  app.put('/api/schedules/:id', async (req, res) => {
    await store.update<CronSchedule>('schedules', req.params.id, req.body);
    const updated = await store.get<CronSchedule>('schedules', req.params.id);
    if (updated) {
      if (updated.isActive) {
        scheduler.register(updated);
      } else {
        scheduler.unregister(updated.id);
      }
    }
    res.json(updated);
  });

  app.delete('/api/schedules/:id', async (req, res) => {
    scheduler.unregister(req.params.id);
    await store.delete('schedules', req.params.id);
    res.status(204).end();
  });

  // --- Executions API ---
  app.get('/api/executions', async (req, res) => {
    const list = await store.list<Execution>('executions');
    // Sort newest first
    list.sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime());
    res.json(list);
  });

  app.get('/api/executions/:id', async (req, res) => {
    const item = await store.get<Execution>('executions', req.params.id);
    if (!item) return res.status(404).json({ error: 'Execution not found' });
    res.json(item);
  });

  // Trigger manually
  app.post('/api/executions/trigger', async (req, res) => {
    const { projectId, workflowId, payload } = req.body;
    if (!workflowId) {
      return res.status(400).json({ error: 'workflowId is required.' });
    }

    try {
      let resolvedProjectId = projectId;
      if (!resolvedProjectId) {
        const workflow = await store.get<Workflow>('workflows', workflowId);
        if (workflow) {
          resolvedProjectId = workflow.projectId;
        }
      }
      const executionId = await executor.createExecution(resolvedProjectId, workflowId, 'manual', payload || {});
      res.status(202).json({ executionId });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Rewind and selective re-execution
  app.post('/api/executions/:id/rewind', async (req, res) => {
    const { id } = req.params;
    const { stepId } = req.body;
    if (!stepId) {
      return res.status(400).json({ error: 'stepId is required.' });
    }

    try {
      const execution = await store.get<Execution>('executions', id);
      if (!execution) {
        return res.status(404).json({ error: 'Execution not found' });
      }

      const snapshot = execution.debugSnapshots?.[stepId];
      if (!snapshot) {
        return res.status(400).json({ error: `No debug snapshot found for step ${stepId}` });
      }

      // Restore execution state from the snapshot
      execution.stepOutputs = snapshot.stepOutputs;
      execution.currentBranch = snapshot.currentBranch;
      execution.artifacts = snapshot.artifacts;
      if (snapshot.variables) {
        execution.variables = snapshot.variables;
      }

      // Clear stepTimings and agentMetrics from the stepId onwards to maintain a clean history
      const index = execution.stepTimings?.findIndex(t => t.stepId === stepId) ?? -1;
      if (index !== -1) {
        execution.stepTimings = execution.stepTimings?.slice(0, index) || [];
      }
      const remainingStepIds = new Set(execution.stepTimings?.map(t => t.stepId) || []);
      if (execution.agentMetrics) {
        for (const key of Object.keys(execution.agentMetrics)) {
          if (!remainingStepIds.has(key)) {
            delete execution.agentMetrics[key];
          }
        }
      }

      execution.status = 'queued';
      execution.pausedStepId = stepId;
      execution.errorMessage = undefined;

      // Add a status history entry to log user-initiated rewind
      if (!execution.statusHistory) execution.statusHistory = [];
      execution.statusHistory.push({
        status: 'queued',
        cause: `Execution rewound to step ${stepId}`,
        actor: 'user',
        at: new Date().toISOString()
      });

      await store.set<Execution>('executions', id, execution);

      // Enqueue the execution in the project queue using the same execution logic
      await executor.enqueueExistingExecution(id, execution.projectId || 'default');

      res.status(202).json({ message: 'Execution rewound and queued.', executionId: id });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Approve / Reject Execution
  app.post('/api/executions/:id/approvals/:approvalId/action', async (req, res) => {
    const { id, approvalId } = req.params;
    const { approved } = req.body;

    if (approved === undefined) {
      return res.status(400).json({ error: 'approved boolean field is required.' });
    }

    try {
      await executor.approveExecution(id, approvalId, approved);
      res.json({ message: `Execution ${approved ? 'approved' : 'rejected'} successfully.` });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // SSE Logs Stream Endpoint
  app.get('/api/executions/:id/logs/stream', async (req, res) => {
    const { id } = req.params;
    const execution = await store.get<Execution>('executions', id);
    if (!execution) {
      return res.status(404).json({ error: 'Execution not found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send history logs first
    for (const log of execution.logs) {
      res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
    }

    // Send current status
    res.write(`event: status\ndata: ${execution.status}\n\n`);

    // Subscribe to new logs
    const unsubscribeLogs = executor.subscribeToLogs(id, (log) => {
      res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
    });

    // Subscribe to status updates
    const unsubscribeStatus = executor.subscribeToStatus(id, (status) => {
      res.write(`event: status\ndata: ${status}\n\n`);
    });

    // Subscribe to per-step events (live timeline)
    const unsubscribeSteps = executor.subscribeToSteps(id, (ev: StepEvent) => {
      res.write(`event: step\ndata: ${JSON.stringify(ev)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      unsubscribeLogs();
      unsubscribeStatus();
      unsubscribeSteps();
      clearInterval(heartbeat);
    });
  });

  // --- Observability (Fase 4) ---

  // Health / readiness endpoint: scheduler job count + per-project queue state.
  app.get('/api/health', async (req, res) => {
    const projects = await store.list<Project>('projects');
    const schedules = await store.list<CronSchedule>('schedules');
    const queues: Record<string, { active: string | null; depth: number }> = {};
    for (const project of projects) {
      queues[project.id] = {
        active: queue.getActiveExecution(project.id) || null,
        depth: queue.getQueueLength(project.id)
      };
    }
    res.json({
      status: 'ok',
      schedulerJobs: schedules.filter(s => s.isActive).length,
      queues,
      uptimeMs: process.uptime() * 1000
    });
  });

  // Aggregated execution metrics derived from stored executions and stepTimings.
  app.get('/api/metrics', async (req, res) => {
    const executions = await store.list<Execution>('executions');
    const total = executions.length;
    const byStatus: Record<string, number> = {};
    const stepDurationByType: Record<string, { count: number; totalMs: number }> = {};
    const modelUsage: Record<string, number> = {};
    let succeeded = 0;

    for (const execution of executions) {
      byStatus[execution.status] = (byStatus[execution.status] || 0) + 1;
      if (execution.status === 'succeeded') succeeded++;

      for (const timing of execution.stepTimings || []) {
        const entry = stepDurationByType[timing.type] || { count: 0, totalMs: 0 };
        entry.count++;
        entry.totalMs += timing.durationMs;
        stepDurationByType[timing.type] = entry;
      }

      // Model usage derived from agent step logs:
      // "Running agent ... (provider: ..., model: ...) with prompt: ..."
      for (const log of execution.logs || []) {
        const match = log.message.match(/model:\s*([^)\s,]+)/);
        if (match) {
          modelUsage[match[1]] = (modelUsage[match[1]] || 0) + 1;
        }
      }
    }

    const avgDurationByStepType: Record<string, number> = {};
    for (const [type, agg] of Object.entries(stepDurationByType)) {
      avgDurationByStepType[type] = agg.count > 0 ? Math.round(agg.totalMs / agg.count) : 0;
    }

    res.json({
      total,
      byStatus,
      successRate: total > 0 ? Number((succeeded / total).toFixed(4)) : 0,
      avgDurationByStepType,
      modelUsage
    });
  });

  // --- Secrets and NoSQL Database API ---
  app.get('/api/projects/:projectId/secrets', async (req, res) => {
    const { projectId } = req.params;
    try {
      const allSecrets = await store.list<EncryptedSecret>('secrets');
      const filtered = allSecrets
        .filter(s => s.projectId === projectId)
        .map(s => {
          const key = s.id.substring(projectId.length + 1);
          return { key, updatedAt: s.updatedAt };
        });
      res.json(filtered);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  });

  app.get('/api/databases', async (req, res) => {
    try {
      const dbs = await store.list<any>('databases');
      res.json(dbs);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  });

  app.get('/api/databases/:id', async (req, res) => {
    try {
      const db = await store.get<any>('databases', req.params.id);
      if (!db) {
        return res.status(404).json({ error: 'Database not found' });
      }
      res.json(db);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  });

  app.get('/api/databases/:id/collections/:collection', async (req, res) => {
    try {
      const db = await store.get<any>('databases', req.params.id);
      if (!db) {
        return res.status(404).json({ error: 'Database not found' });
      }
      const documents = await noSqlDocuments.list(req.params.id, req.params.collection);
      res.json(documents);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  });

  app.post('/api/databases', async (req, res) => {
    try {
      const { id, name } = req.body;
      if (!id || !name) {
        return res.status(400).json({ error: 'Database ID and Name are required.' });
      }
      const sanitizedId = id.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const existing = await store.get<any>('databases', sanitizedId);
      if (existing) {
        return res.status(409).json({ error: `Database with ID '${sanitizedId}' already exists.` });
      }
      const now = new Date().toISOString();
      const newDb = {
        id: sanitizedId,
        name,
        collections: {},
        createdAt: now,
        updatedAt: now
      };
      await store.set('databases', sanitizedId, newDb);
      res.status(201).json(newDb);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  });

  app.delete('/api/databases/:id', async (req, res) => {
    try {
      const db = await store.get<any>('databases', req.params.id);
      if (!db) {
        return res.status(404).json({ error: 'Database not found' });
      }
      await noSqlDocuments.deleteDatabase(req.params.id);
      await store.delete('databases', req.params.id);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  });

  app.post('/api/databases/:id/collections/:collection', async (req, res) => {
    try {
      const { id, collection } = req.params;
      const db = await store.get<any>('databases', id);
      if (!db) {
        return res.status(404).json({ error: 'Database not found' });
      }
      const document = { ...req.body };
      if (!document.id) {
        document.id = `doc_${Math.floor(10000 + Math.random() * 90000)}`;
      }
      
      if (!db.collections) {
        db.collections = {};
      }
      if (!db.collections[collection]) {
        db.collections[collection] = {};
      }
      db.updatedAt = new Date().toISOString();
      const mergedDoc = await noSqlDocuments.upsert(id, collection, document);
      const currentDb = await store.get<any>('databases', id);
      if (currentDb) {
        currentDb.collections = { ...(currentDb.collections || {}), [collection]: {} };
        currentDb.updatedAt = new Date().toISOString();
        await store.set('databases', id, currentDb);
      }
      res.status(200).json(mergedDoc);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  });

  app.delete('/api/databases/:id/collections/:collection/:docId', async (req, res) => {
    try {
      const { id, collection, docId } = req.params;
      const db = await store.get<any>('databases', id);
      if (!db) {
        return res.status(404).json({ error: 'Database not found' });
      }
       if (db.collections && db.collections[collection] !== undefined) {
          db.updatedAt = new Date().toISOString();
          await noSqlDocuments.delete(id, collection, docId);
          await store.set('databases', id, db);
        }
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  });

  app.delete('/api/databases/:id/collections/:collection', async (req, res) => {
    try {
      const { id, collection } = req.params;
      const db = await store.get<any>('databases', id);
      if (!db) {
        return res.status(404).json({ error: 'Database not found' });
      }
      if (db.collections && db.collections[collection] !== undefined) {
         await noSqlDocuments.deleteCollection(id, collection);
         const currentDb = await store.get<any>('databases', id);
         if (currentDb?.collections) {
           delete currentDb.collections[collection];
           currentDb.updatedAt = new Date().toISOString();
           await store.set('databases', id, currentDb);
         }
      }
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  });

  return { app, scheduler, executor };
}
