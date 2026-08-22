import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vm from 'vm';
import * as crypto from 'crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { 
  Project, 
  Workflow, 
  WorkflowStep, 
  Execution, 
  IStateStore, 
  IOpenCodeRunner, 
  IGitProvider, 
  ISecretStore,
  ExecutionLog,
  ApprovalRequest,
  ExecutionStatus,
  StepEvent,
  StepType
} from '@opencode/shared';
import { ProjectQueueManager } from './queue';
import { NoSqlDocumentStore } from './nosql';
import { v4 as uuidv4 } from 'uuid';

let shellDiagnosticLogged = false;

const DEFAULT_CAPTURE_BYTES = 4 * 1024 * 1024;
const MAX_LOG_MESSAGE_BYTES = 256 * 1024;
const MAX_SECRET_CACHE_PROJECTS = 100;
const SECRET_CACHE_TTL_MS = 5 * 60 * 1000;

function limitedText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  return `${Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8')} [truncated]`;
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('Operation aborted.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.max(0, delayMs));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Operation aborted.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readResponseTextLimited(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('HTTP response exceeds the maximum allowed size.');
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new Error('HTTP response exceeds the maximum allowed size.');
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  return limitedText(await response.text(), maxBytes);
}

export class WorkflowExecutor {
  private store: IStateStore;
  private runner: IOpenCodeRunner;
  private git: IGitProvider;
  private secrets: ISecretStore;
  private queue: ProjectQueueManager;
  private logListeners = new Map<string, ((log: ExecutionLog) => void)[]>();
  private statusListeners = new Map<string, ((status: ExecutionStatus) => void)[]>();
  private stepListeners = new Map<string, ((e: StepEvent) => void)[]>();
  private secretCache = new Map<string, { values: string[]; cachedAt: number }>();
  private noSqlDocuments: NoSqlDocumentStore;

  constructor(
    store: IStateStore,
    runner: IOpenCodeRunner,
    git: IGitProvider,
    secrets: ISecretStore,
    queue: ProjectQueueManager
  ) {
    this.store = store;
    this.runner = runner;
    this.git = git;
    this.secrets = secrets;
    this.queue = queue;
    this.noSqlDocuments = new NoSqlDocumentStore(store);
  }

  // Subscribe to real-time logs for a specific execution
  subscribeToLogs(executionId: string, listener: (log: ExecutionLog) => void): () => void {
    if (!this.logListeners.has(executionId)) {
      this.logListeners.set(executionId, []);
    }
    this.logListeners.get(executionId)!.push(listener);
    return () => {
      const listeners = this.logListeners.get(executionId) || [];
      this.logListeners.set(executionId, listeners.filter(l => l !== listener));
    };
  }

  // Subscribe to real-time status updates for a specific execution
  subscribeToStatus(executionId: string, listener: (status: ExecutionStatus) => void): () => void {
    if (!this.statusListeners.has(executionId)) {
      this.statusListeners.set(executionId, []);
    }
    this.statusListeners.get(executionId)!.push(listener);
    return () => {
      const listeners = this.statusListeners.get(executionId) || [];
      this.statusListeners.set(executionId, listeners.filter(l => l !== listener));
    };
  }

  // Subscribe to per-step events for a specific execution (live timeline)
  subscribeToSteps(executionId: string, listener: (e: StepEvent) => void): () => void {
    if (!this.stepListeners.has(executionId)) {
      this.stepListeners.set(executionId, []);
    }
    this.stepListeners.get(executionId)!.push(listener);
    return () => {
      const listeners = this.stepListeners.get(executionId) || [];
      this.stepListeners.set(executionId, listeners.filter(l => l !== listener));
    };
  }

  private emitStep(executionId: string, stepId: string, type: StepType, status: StepEvent['status']) {
    const event: StepEvent = {
      executionId,
      stepId,
      type,
      status,
      at: new Date().toISOString()
    };
    const listeners = this.stepListeners.get(executionId) || [];
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('Step listener threw:', err);
      }
    }
  }

  private notifyStatusChange(executionId: string, status: ExecutionStatus) {
    const listeners = this.statusListeners.get(executionId) || [];
    for (const listener of listeners) {
      listener(status);
    }
  }

  private async failExecution(executionId: string, err: any): Promise<void> {
    const execution = await this.store.get<Execution>('executions', executionId);
    if (!execution) return;

    if (execution.status !== 'failed' && execution.status !== 'cancelled' && execution.status !== 'succeeded') {
      execution.status = 'failed';
      const rawMessage = err?.message || String(err);
      const redactedMessage = await this.redactSecrets(rawMessage, execution.projectId);
      execution.errorMessage = redactedMessage;
      execution.completedAt = new Date().toISOString();
      this.recordStatus(execution, 'failed', redactedMessage);
      await this.store.set<Execution>('executions', executionId, execution);
      this.notifyStatusChange(executionId, 'failed');
      await this.log(executionId, 'error', `Workflow execution failed: ${redactedMessage}`);
      console.error(`Workflow execution failed:`, err);
    }
  }

  private runWithGuard(executionId: string, job: () => Promise<void>, signal?: AbortSignal): Promise<void> {
    return (async () => {
      try {
        await job();
      } catch (err) {
        await this.failExecution(executionId, err);
      } finally {
        const execution = await this.store.get<Execution>('executions', executionId);
        if (execution && execution.status === 'running' && !execution.completedAt) {
          const errorMsg = signal?.aborted
            ? 'Execution terminated due to timeout/cancellation.'
            : 'Execution terminated unexpectedly (no terminal state reached).';
          execution.status = 'failed';
          execution.errorMessage = errorMsg;
          execution.completedAt = new Date().toISOString();
          this.recordStatus(execution, 'failed', errorMsg, 'system');
          await this.store.set<Execution>('executions', executionId, execution);
          this.notifyStatusChange(executionId, 'failed');
          await this.log(executionId, 'error', errorMsg);
        }
      }
    })();
  }

  private async log(executionId: string, level: 'info' | 'warn' | 'error', message: string) {
    const logEntry: ExecutionLog = {
      timestamp: new Date().toISOString(),
      level,
      message: limitedText(message, MAX_LOG_MESSAGE_BYTES)
    };

    // Store in DB
    const exec = await this.store.get<Execution>('executions', executionId);
    if (exec) {
      exec.logs.push(logEntry);
      await this.store.set<Execution>('executions', executionId, exec);
    }

    // Notify listeners
    const listeners = this.logListeners.get(executionId) || [];
    for (const listener of listeners) {
      listener(logEntry);
    }
  }

  async createExecution(projectId: string | undefined, workflowId: string, triggerType: 'webhook' | 'cron' | 'manual', triggerPayload: any, opts?: { idempotencyKey?: string }): Promise<string> {
    const project = projectId ? await this.store.get<Project>('projects', projectId) : undefined;
    if (projectId && !project) throw new Error(`Project ${projectId} not found.`);

    const workflow = await this.store.get<Workflow>('workflows', workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found.`);

    const idempotencyKey = opts?.idempotencyKey;
    if (idempotencyKey) {
      const existing = await this.store.list<Execution>('executions', e => e.idempotencyKey === idempotencyKey && e.workflowId === workflowId);
      if (existing.length > 0) {
        const existingExecution = existing[0];
        await this.log(existingExecution.id, 'info', `Execution with idempotencyKey "${idempotencyKey}" already exists (execution ${existingExecution.id}). Skipping creation.`);
        return existingExecution.id;
      }
    }

    const executionId = uuidv4();
    const execution: Execution = {
      id: executionId,
      projectId: projectId || '',
      workflowId,
      workflowVersion: workflow.version,
      triggerType,
      triggerPayload,
      status: 'queued',
      artifacts: [],
      logs: [],
      pendingApprovals: [],
      stepOutputs: {},
      stepTimings: [],
      queuedAt: new Date().toISOString(),
      ...(idempotencyKey ? { idempotencyKey } : {})
    };
    this.recordStatus(execution, 'queued', 'Execution created and queued.', 'system');

    await this.store.set<Execution>('executions', executionId, execution);
    this.notifyStatusChange(executionId, 'queued');
    await this.log(executionId, 'info', `Execution created and queued${project ? ` for project ${project.name}` : ''}.`);
    
    // Enqueue execution
    this.queue.enqueue(projectId || 'default', executionId, (signal?: AbortSignal) => this.runWithGuard(executionId, () => this.runExecution(executionId, signal), signal));

    return executionId;
  }

  async enqueueExistingExecution(executionId: string, projectId: string): Promise<void> {
    await this.log(executionId, 'info', `Execution rewound/resumed and queued.`);
    this.queue.enqueue(
      projectId || 'default',
      executionId,
      (signal?: AbortSignal) => this.runWithGuard(executionId, () => this.runExecution(executionId, signal), signal)
    );
  }

  private async runExecution(executionId: string, signal?: AbortSignal): Promise<void> {
    const execution = await this.store.get<Execution>('executions', executionId);
    if (!execution || execution.status === 'cancelled') return;

    const project = execution.projectId ? await this.store.get<Project>('projects', execution.projectId) : undefined;
    const workflow = await this.store.get<Workflow>('workflows', execution.workflowId);

    if (!workflow) {
      const errorMsg = 'Workflow not found.';
      execution.status = 'failed';
      execution.errorMessage = errorMsg;
      execution.completedAt = new Date().toISOString();
      this.recordStatus(execution, 'failed', errorMsg, 'system');
      await this.store.set<Execution>('executions', executionId, execution);
      this.notifyStatusChange(executionId, 'failed');
      await this.log(executionId, 'error', errorMsg);
      return;
    }

    execution.status = 'running';
    execution.startedAt = new Date().toISOString();
    this.recordStatus(execution, 'running', 'Workflow started.', 'system');
    await this.store.set<Execution>('executions', executionId, execution);
    this.notifyStatusChange(executionId, 'running');
    await this.log(executionId, 'info', `Starting workflow "${workflow.name}" execution.`);

    try {
      // 1. Setup local project workspace
      if (project && project.localPath) {
        await this.log(executionId, 'info', `Checking local repository path: ${project.localPath}`);
        try {
          if (!existsSync(project.localPath)) {
            mkdirSync(project.localPath, { recursive: true });
          }
        } catch (err) {
          await this.log(executionId, 'warn', `Could not create project workspace ${project.localPath}: ${err}`);
        }
        await this.git.cloneOrFetch(project.localPath, project.gitRemoteUrl);
      }

      // 2. Set context variables
      const context = {
        executionId,
        projectId: project?.id,
        workflowId: workflow.id,
        triggerType: execution.triggerType,
        triggerPayload: execution.triggerPayload,
        repositoryPath: project?.localPath || '',
        baseBranch: project?.baseBranch || 'main',
        currentBranch: execution.currentBranch || project?.baseBranch || 'main',
        artifacts: execution.artifacts || [],
        stepOutputs: (execution.stepOutputs || {}) as Record<string, any>,
        variables: (execution.variables || {}) as Record<string, any>
      };

      // 3. Process workflow steps starting from triggers
      const stepsMap = new Map<string, WorkflowStep>();
      for (const step of workflow.steps) {
        stepsMap.set(step.id, step);
      }

      // Find trigger or first steps
      let currentStep: WorkflowStep | undefined;
      if (execution.pausedStepId) {
        currentStep = stepsMap.get(execution.pausedStepId);
        execution.pausedStepId = undefined;
        await this.store.set<Execution>('executions', executionId, execution);
      } else {
        currentStep = workflow.steps.find(s => s.type === 'trigger' || s.type === 'normalizer') || workflow.steps[0];
      }

      while (currentStep) {
        const out = await this.executeNode(executionId, currentStep, context, project || undefined, stepsMap, signal);

        // Handle approvals (approval node pauses execution)
        if (out.waitingApproval) {
          const latestExecution = await this.store.get<Execution>('executions', executionId);
          if (!latestExecution) return;
          latestExecution.status = 'waiting_approval';
          latestExecution.pendingApprovals = [
            {
              approvalId: currentStep.id,
              actionType: 'user_approval',
              description: this.interpolateString(currentStep.config.description || 'Human approval required to proceed.', context)
            }
          ];
          this.recordStatus(latestExecution, 'waiting_approval', `Waiting for human approval on step "${currentStep.id}".`, 'system');
          await this.store.set<Execution>('executions', executionId, latestExecution);
          this.notifyStatusChange(executionId, 'waiting_approval');
          await this.log(executionId, 'warn', `Execution paused. Waiting for human approval on step "${currentStep.id}".`);
          return; // Pause execution loop
        }

        if (currentStep.type === 'condition') {
          const conditionOutcome = out.stepResult.outcome ? 'true' : 'false';
          await this.log(executionId, 'info', `Condition evaluated to ${conditionOutcome}`);
        }

        currentStep = out.nextStepId ? stepsMap.get(out.nextStepId) : undefined;
      }

      // Successful completion (re-fetch latest to preserve stepOutputs/stepTimings persisted by executeNode)
      const latestExecution = await this.store.get<Execution>('executions', executionId);
      if (latestExecution) {
        latestExecution.status = 'succeeded';
        latestExecution.completedAt = new Date().toISOString();
        latestExecution.currentBranch = context.currentBranch;
        latestExecution.artifacts = context.artifacts;
        this.recordStatus(latestExecution, 'succeeded');
        await this.store.set<Execution>('executions', executionId, latestExecution);
      }
      this.notifyStatusChange(executionId, 'succeeded');
      await this.log(executionId, 'info', `Workflow execution completed successfully.`);
    } catch (err: any) {
      console.error(`Workflow execution failed:`, err);
      const latestExecution = await this.store.get<Execution>('executions', executionId);
      if (latestExecution) {
        const rawMessage = err.message || String(err);
        const redactedMessage = await this.redactSecrets(rawMessage, latestExecution.projectId);
        latestExecution.status = 'failed';
        latestExecution.errorMessage = redactedMessage;
        latestExecution.completedAt = new Date().toISOString();
        this.recordStatus(latestExecution, 'failed', redactedMessage);
        await this.store.set<Execution>('executions', executionId, latestExecution);
        this.notifyStatusChange(executionId, 'failed');
        await this.log(executionId, 'error', `Workflow execution failed: ${redactedMessage}`);
      }
    }
  }

  // Resume a paused execution (after human approval)
  async approveExecution(executionId: string, approvalId: string, approved: boolean): Promise<void> {
    const execution = await this.store.get<Execution>('executions', executionId);
    if (!execution || execution.status !== 'waiting_approval') {
      throw new Error('Execution is not in waiting_approval state.');
    }

    if (!approved) {
      execution.status = 'cancelled';
      execution.completedAt = new Date().toISOString();
      execution.pendingApprovals = [];
      this.recordStatus(execution, 'cancelled', 'Execution rejected/cancelled by user.', 'user');
      await this.store.set<Execution>('executions', executionId, execution);
      this.notifyStatusChange(executionId, 'cancelled');
      await this.log(executionId, 'warn', `Execution rejected/cancelled by user.`);
      return;
    }

    await this.log(executionId, 'info', `Execution approved by user. Resuming workflow.`);
    
    // Clear pending approvals and transition to running
    execution.status = 'running';
    execution.pendingApprovals = [];
    this.recordStatus(execution, 'running', 'Execution approved by user.', 'user');
    await this.store.set<Execution>('executions', executionId, execution);
    this.notifyStatusChange(executionId, 'running');

    // Queue the resumption of the execution
    this.queue.enqueue(execution.projectId || 'default', executionId, (signal?: AbortSignal) => this.runWithGuard(executionId, async () => {
      // Re-run from the approval step's outputs (we resume processing subsequent steps)
      const project = execution.projectId ? await this.store.get<Project>('projects', execution.projectId) : undefined;
      const workflow = await this.store.get<Workflow>('workflows', execution.workflowId);
      
      if (!workflow) {
        throw new Error('Workflow not found during resume.');
      }

      // Rebuild context from logs/stepOutputs if serialized. In this MVP, we assume we resume execution logic.
      // To keep it simple: we reconstruct context and skip already executed steps.
      const context = {
        executionId,
        projectId: project?.id,
        workflowId: workflow.id,
        triggerType: execution.triggerType,
        triggerPayload: execution.triggerPayload,
        repositoryPath: project?.localPath || '',
        baseBranch: project?.baseBranch || 'main',
        currentBranch: execution.currentBranch || project?.baseBranch || 'main',
        artifacts: execution.artifacts || [],
        stepOutputs: (execution.stepOutputs || {}) as Record<string, any>,
        variables: (execution.variables || {}) as Record<string, any>
      };

      // Set the step outputs that are already completed
      // Find the approval step
      const stepsMap = new Map<string, WorkflowStep>();
      for (const step of workflow.steps) {
        stepsMap.set(step.id, step);
      }

      const approvalStep = stepsMap.get(approvalId);
      if (!approvalStep) {
        throw new Error(`Approval step ${approvalId} not found in workflow.`);
      }

      // Resume from approvalStep's next step
      let currentStep: WorkflowStep | undefined = stepsMap.get(approvalStep.nextStepIds[0]);

      while (currentStep) {
        const out = await this.executeNode(executionId, currentStep, context, project || undefined, stepsMap, signal);

        if (out.waitingApproval) {
          const latestExecution = await this.store.get<Execution>('executions', executionId);
          if (!latestExecution) return;
          latestExecution.status = 'waiting_approval';
          latestExecution.pendingApprovals = [
            {
              approvalId: currentStep.id,
              actionType: 'user_approval',
              description: this.interpolateString(currentStep.config.description || 'Human approval required to proceed.', context)
            }
          ];
          this.recordStatus(latestExecution, 'waiting_approval', `Waiting for human approval on step "${currentStep.id}".`, 'system');
          await this.store.set<Execution>('executions', executionId, latestExecution);
          this.notifyStatusChange(executionId, 'waiting_approval');
          await this.log(executionId, 'warn', `Execution paused again. Waiting for human approval on step "${currentStep.id}".`);
          return;
        }

        currentStep = out.nextStepId ? stepsMap.get(out.nextStepId) : undefined;
      }

      const latestExecution = await this.store.get<Execution>('executions', executionId);
      if (latestExecution) {
        latestExecution.status = 'succeeded';
        latestExecution.completedAt = new Date().toISOString();
        latestExecution.currentBranch = context.currentBranch;
        latestExecution.artifacts = context.artifacts;
        this.recordStatus(latestExecution, 'succeeded');
        await this.store.set<Execution>('executions', executionId, latestExecution);
      }
      this.notifyStatusChange(executionId, 'succeeded');
      await this.log(executionId, 'info', `Workflow execution completed successfully after resume.`);
    }, signal));
  }

  /**
   * Reconciles executions left in a non-terminal state after a process restart.
   *
   * - Executions still `queued` are re-enqueued so the normal flow processes them.
   * - Executions stuck `running` (killed mid-flight without a terminal state) cannot be
   *   resumed reliably from disk, so they are marked `failed` with a clear cause.
   *
   * Call this once at startup after the services are initialized.
   */
  async recoverStaleExecutions(): Promise<void> {
    const stale = await this.store.list<Execution>('executions', (e) => {
      return (e.status === 'queued' || e.status === 'running') && !e.completedAt;
    });

    for (const execution of stale) {
      const projectId = execution.projectId || 'default';
      if (execution.status === 'queued') {
        await this.log(execution.id, 'warn', 'Recovered queued execution after restart; re-enqueuing.');
        this.queue.enqueue(projectId, execution.id, (signal?: AbortSignal) =>
          this.runWithGuard(execution.id, () => this.runExecution(execution.id, signal), signal)
        );
      } else {
        // running without a terminal state -> interrupted by a hard kill
        await this.log(execution.id, 'warn', 'Execution was interrupted by a restart; marking as failed.');
        await this.failExecution(execution.id, new Error('Execution interrupted by process restart (recovered as failed).'));
      }
    }
  }

  private recordStatus(execution: Execution, status: ExecutionStatus, cause?: string, actor?: 'system' | 'agent' | 'user') {
    if (!execution.statusHistory) execution.statusHistory = [];
    execution.statusHistory.push({
      status,
      cause,
      actor,
      at: new Date().toISOString()
    });
  }

  private async executeStepWithRetry(step: WorkflowStep, context: any, project?: Project, signal?: AbortSignal): Promise<any> {
    const config = step.config || {};
    const retries = typeof config.retries === 'number' ? config.retries : 0;
    const retryDelayMs = typeof config.retryDelayMs === 'number' ? config.retryDelayMs : 1000;
    const onError = config.onError === 'continue' ? 'continue' : 'fail';

    let attempt = 0;
    while (true) {
      try {
        return await this.executeStep(step, context, project, signal);
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (attempt < retries) {
          attempt++;
          await this.log(context.executionId, 'warn', `Step "${step.id}" failed (attempt ${attempt}/${retries}). Retrying in ${retryDelayMs}ms. Error: ${msg}`);
          await abortableDelay(retryDelayMs, signal);
          continue;
        }
        if (onError === 'continue') {
          await this.log(context.executionId, 'warn', `Step "${step.id}" failed after ${attempt} retr${attempt === 1 ? 'y' : 'ies'}. Continuing (onError=continue). Error: ${msg}`);
          return { success: false, error: msg };
        }
        throw err;
      }
    }
  }

  /**
   * Executes a single workflow node within the main loop: measures timing, emits
   * step events, persists stepOutputs/stepTimings, detects approval pauses and
   * resolves the next step id (honoring control-flow continuation rules).
   */
  private async executeNode(
    executionId: string,
    step: WorkflowStep,
    context: any,
    project: Project | undefined,
    stepsMap: Map<string, WorkflowStep>,
    signal?: AbortSignal
  ): Promise<{ stepResult: any; nextStepId?: string; waitingApproval: boolean }> {
    await this.log(executionId, 'info', `Executing step "${step.id}" [type: ${step.type}]`);
    this.emitStep(executionId, step.id, step.type, 'started');
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const execution = await this.store.get<Execution>('executions', executionId);

    if (execution) {
      if (!execution.debugSnapshots) {
        execution.debugSnapshots = {};
      }
      execution.debugSnapshots[step.id] = {
        stepOutputs: JSON.parse(JSON.stringify(context.stepOutputs || {})),
        currentBranch: context.currentBranch,
        artifacts: [...(context.artifacts || [])],
        variables: JSON.parse(JSON.stringify(context.variables || {}))
      };
      await this.store.set<Execution>('executions', executionId, execution);
    }

    let stepResult: any;
    try {
      stepResult = await this.dispatchStep(step, context, project, stepsMap, signal);
    } catch (err: any) {
      if (execution) {
        execution.stepTimings = execution.stepTimings || [];
        execution.stepTimings.push({
          stepId: step.id,
          type: step.type,
          startedAt,
          durationMs: Date.now() - startMs,
          outcome: 'failed'
        });
        await this.store.set<Execution>('executions', executionId, execution);
      }
      this.emitStep(executionId, step.id, step.type, 'failed');
      throw err;
    }

    const waitingApproval = step.type === 'approval' && stepResult?.waiting === true;

    if (execution) {
      execution.stepTimings = execution.stepTimings || [];
      execution.stepTimings.push({
        stepId: step.id,
        type: step.type,
        startedAt,
        durationMs: Date.now() - startMs,
        outcome: 'success'
      });
      // Fase v2 — Persistir métricas de agente por paso (junto a stepTimings/stepOutputs).
      const metrics = stepResult?.metrics;
      if (step.type === 'agent' && metrics && (
        metrics.durationMs !== undefined
        || metrics.model !== undefined
        || metrics.inputTokens !== undefined
        || metrics.outputTokens !== undefined
        || metrics.totalTokens !== undefined
        || metrics.estimatedCostUsd !== undefined
      )) {
        execution.agentMetrics = execution.agentMetrics || {};
        execution.agentMetrics[step.id] = metrics;
      }
       // Add the current result before persisting. Otherwise the last node is
       // reported as completed but its output only reaches disk when another
       // node happens to run afterwards.
       context.stepOutputs[step.id] = stepResult;
       execution.stepOutputs = context.stepOutputs;
       execution.variables = context.variables;
       await this.store.set<Execution>('executions', executionId, execution);
    }

    if (!execution) {
      context.stepOutputs[step.id] = stepResult;
    }
    await this.log(executionId, 'info', `Step "${step.id}" finished.`);

    if (waitingApproval) {
      this.emitStep(executionId, step.id, step.type, 'waiting_approval');
      return { stepResult, waitingApproval: true, nextStepId: undefined };
    }

    this.emitStep(executionId, step.id, step.type, 'finished');

    let nextStepId: string | undefined;
    if (step.type === 'condition') {
      nextStepId = stepResult.outcome ? step.config.onTrue : step.config.onFalse;
    } else if (step.type === 'loop') {
      // After iterating the body, continue at joinNextStepId or the second entry.
      nextStepId = step.config.joinNextStepId || step.nextStepIds[1];
    } else if (step.type === 'parallel') {
      // After joining branches, continue at joinNextStepId or the first entry.
      nextStepId = step.config.joinNextStepId || step.nextStepIds[0];
    } else {
      nextStepId = step.nextStepIds[0]; // Take first branch by default
    }

    return { stepResult, waitingApproval: false, nextStepId };
  }

  /**
   * Dispatches a step to the right handler. Control-flow nodes (retry, parallel,
   * loop) are handled here because they need access to the stepsMap; everything
   * else falls through to executeStepWithRetry.
   */
  private async dispatchStep(
    step: WorkflowStep,
    context: any,
    project: Project | undefined,
    stepsMap: Map<string, WorkflowStep>,
    signal?: AbortSignal
  ): Promise<any> {
    switch (step.type) {
      case 'retry': {
        const childStep = stepsMap.get(step.nextStepIds[0]);
        if (!childStep) {
          throw new Error(`Retry step "${step.id}" has no child step configured (nextStepIds[0]).`);
        }
        const config = step.config || {};
        const retries = typeof config.retries === 'number' ? config.retries : 0;
        const retryDelayMs = typeof config.retryDelayMs === 'number' ? config.retryDelayMs : 1000;

        let attempt = 0;
        while (true) {
          try {
            return await this.executeStepWithRetry(childStep, context, project, signal);
          } catch (err: any) {
            const msg = err?.message || String(err);
            if (attempt < retries) {
              attempt++;
              await this.log(context.executionId, 'warn', `Retry node "${step.id}" child "${childStep.id}" failed (attempt ${attempt}/${retries}). Retrying in ${retryDelayMs}ms. Error: ${msg}`);
              await abortableDelay(retryDelayMs, signal);
              continue;
            }
            throw err;
          }
        }
      }

      case 'parallel': {
        const branches = (step.nextStepIds || [])
          .map(id => stepsMap.get(id))
          .filter((s): s is WorkflowStep => !!s);
        if (branches.length === 0) {
          throw new Error(`Parallel step "${step.id}" has no branches configured in nextStepIds.`);
        }
        await this.log(context.executionId, 'info', `Parallel step "${step.id}" forking ${branches.length} branch(es).`);
        const results = await Promise.all(
          branches.map(async (branch) => {
            await this.log(context.executionId, 'info', `Parallel branch "${branch.id}" started.`);
            return this.runSubgraph(branch, context, project, stepsMap, signal);
          })
        );
        return { success: true, branches: results };
      }

      case 'loop': {
        const config = step.config || {};
        let items: any[];
        if (Array.isArray(config.items)) {
          items = config.items;
        } else if (typeof config.itemsExpr === 'string' && config.itemsExpr.trim()) {
          const val = this.evaluateExpression(config.itemsExpr, context);
          items = Array.isArray(val) ? val : [];
        } else {
          items = [];
        }

        const maxIterations = typeof config.maxIterations === 'number' ? config.maxIterations : 100;
        const itemVar = config.itemVar || 'item';
        const bodyStep = stepsMap.get(step.nextStepIds[0]);
        if (!bodyStep) {
          throw new Error(`Loop step "${step.id}" has no body step configured (nextStepIds[0]).`);
        }

        const iterationResults: any[] = [];
        const iterations = Math.min(items.length, maxIterations);
        for (let i = 0; i < iterations; i++) {
          context.variables[itemVar] = items[i];
          await this.log(context.executionId, 'info', `Loop step "${step.id}" iteration ${i + 1}/${items.length}.`);
          iterationResults.push(await this.runSubgraph(bodyStep, context, project, stepsMap, signal));
        }
        delete context.variables[itemVar];

        return { success: true, iterations, results: iterationResults };
      }

      default:
        return this.executeStepWithRetry(step, context, project, signal);
    }
  }

  /**
   * Executes a linear sub-graph starting at `startStep` (following nextStepIds[0]
   * chains). Used to run parallel branches and loop bodies. Each visited step is
   * recorded in stepOutputs and stepTimings via executeNode.
   */
  private async runSubgraph(
    startStep: WorkflowStep,
    context: any,
    project: Project | undefined,
    stepsMap: Map<string, WorkflowStep>,
    signal?: AbortSignal
  ): Promise<Record<string, any>> {
    const outputs: Record<string, any> = {};
    let current: WorkflowStep | undefined = startStep;
    while (current) {
      const out = await this.executeNode(context.executionId, current, context, project, stepsMap, signal);
      if (out.waitingApproval) {
        // Cannot pause the whole execution from inside a subgraph; stop this branch.
        await this.log(context.executionId, 'warn', `Approval requested inside subgraph step "${current.id}"; branch stopped.`);
        break;
      }
      outputs[current.id] = out.stepResult;
      current = out.nextStepId ? stepsMap.get(out.nextStepId) : undefined;
    }
    return outputs;
  }

  private async resolveGoogleToken(rawToken: string, executionId: string): Promise<string> {
    if (!rawToken) return '';
    const trimmed = rawToken.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const sa = JSON.parse(trimmed);
        if (sa.client_email && sa.private_key) {
          await this.log(executionId, 'info', `Google Service Account detected. Exchanging for access token via OAuth2...`);
          
          const iat = Math.floor(Date.now() / 1000);
          const exp = iat + 3600;

          const b64 = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url');
          const input = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
            iss: sa.client_email,
            scope: 'https://www.googleapis.com/auth/spreadsheets',
            aud: 'https://oauth2.googleapis.com/token',
            exp,
            iat
          })}`;
          
          const sign = crypto.createSign('RSA-SHA256');
          sign.update(input);
          const signature = sign.sign(sa.private_key, 'base64url');
          const jwt = `${input}.${signature}`;

          const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
              assertion: jwt
            }).toString()
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Failed to exchange service account key: ${res.status} ${errText}`);
          }

          const data = await res.json() as { access_token: string };
          await this.log(executionId, 'info', `Successfully obtained OAuth2 access token for Service Account.`);
          return data.access_token;
        }
      } catch (err: any) {
        await this.log(executionId, 'error', `Failed to parse or exchange Google Service Account: ${err.message}`);
        throw err;
      }
    }
    return rawToken;
  }

  private async executeStep(step: WorkflowStep, context: any, project?: Project, signal?: AbortSignal): Promise<any> {
    // Resolve target project and working directory path dynamically
    let targetProject: Project | undefined = undefined;
    let targetLocalPath = '';

    if (step.config?.projectId) {
      targetProject = await this.store.get<Project>('projects', step.config.projectId) || undefined;
      if (targetProject) {
        targetLocalPath = targetProject.localPath;
        // Make sure the directory exists before any shell/git/output step uses it
        try {
          if (!existsSync(targetLocalPath)) {
            mkdirSync(targetLocalPath, { recursive: true });
          }
        } catch (err) {
          await this.log(context.executionId, 'warn', `Could not create target project workspace ${targetLocalPath}: ${err}`);
        }
        // Make sure it is cloned/fetched
        try {
          await this.git.cloneOrFetch(targetProject.localPath, targetProject.gitRemoteUrl);
        } catch (err) {
          await this.log(context.executionId, 'warn', `Failed to clone/fetch target project ${targetProject.name}: ${err}`);
        }
      }
    }

    if (!targetLocalPath) {
      if (project) {
        targetProject = project;
        targetLocalPath = project.localPath;
      } else {
        targetLocalPath = path.join(os.tmpdir(), 'opencode-temp-workspace');
        await fs.mkdir(targetLocalPath, { recursive: true });
      }
    }

    switch (step.type) {
      case 'trigger':
        return { success: true, payload: context.triggerPayload };

      case 'wait': {
        const durationMs = step.config.durationMs || 0;
        await abortableDelay(durationMs, signal);
        await this.log(context.executionId, 'info', `Wait step completed after ${durationMs}ms.`);
        return { success: true, waitedMs: durationMs };
      }

      case 'normalizer': {
        if (step.config.parserMode || step.config.parserInput) {
          return this.executeJsonParserNode({
            ...step.config,
            inputExpr: step.config.parserInput || step.config.inputExpr,
            operation: step.config.parserMode || step.config.operation || 'parse'
          }, context);
        }
        // Evaluate input mappings if specified in config
        const normalized: Record<string, any> = {};
        const mapping = step.config.mapping || {};
        for (const [key, expr] of Object.entries(mapping)) {
          normalized[key] = this.evaluateExpression(expr as string, context);
        }
        return normalized;
      }

      case 'agent': {
        const prompt = this.interpolateString(step.config.prompt, context);
        const model = step.config.model;
        const agentName = step.config.agent;
        const provider = step.config.provider;

        await this.log(context.executionId, 'info', `Running agent "${agentName || 'default'}" (provider: ${provider || 'default'}, model: ${model || 'default'}) with prompt: "${prompt.slice(0, 80)}..."`);
        
        const runParams = {
          message: prompt,
          model,
          agent: agentName,
          workdir: targetLocalPath,
          onLog: async (line: string) => {
            // Clean/redact secrets from agent output
            const redacted = targetProject 
              ? await this.redactSecrets(line, targetProject.id) 
              : line;
            await this.log(context.executionId, 'info', `[OpenCode] ${redacted}`);
          },
          ...(signal ? { signal } : {})
        };
        const result = await this.runner.run(runParams);

        if (!result.success) {
          throw new Error(`OpenCode runner failed with code ${result.exitCode}. Output: ${result.output.slice(-200)}`);
        }

        return { success: true, output: result.output, metrics: result.metrics };
      }

      case 'condition': {
        const expression = step.config.expression; // e.g. "context.stepOutputs.agent1.output.includes('fix')"
        const outcome = this.evaluateJSExpression(expression, context);
        return { success: true, outcome };
      }

      case 'shell_test': {
        const cmd = step.config.command;
        // Verify if command is pre-authorized
        const isAuthorized = targetProject
          ? targetProject.allowedCommands.some(allowed => {
            const rule = String(allowed).trim();
            return rule.length > 0 && (cmd === rule || /^\s/.test(cmd.slice(rule.length)) && cmd.startsWith(rule));
          })
          : true;

        if (targetProject && !isAuthorized) {
          throw new Error(`Shell command "${cmd}" is not pre-authorized in project policy.`);
        }

        await this.log(context.executionId, 'info', `Running shell test: "${cmd}"`);
        const execResult = await this.executeShell(cmd, targetLocalPath, signal);
        const redactedShellOutput = targetProject
          ? await this.redactSecrets(`Shell output:\n${execResult.stdout}\n${execResult.stderr}`, targetProject.id)
          : `Shell output:\n${execResult.stdout}\n${execResult.stderr}`;
        await this.log(context.executionId, 'info', redactedShellOutput);
        
        if (execResult.code !== 0) {
          throw new Error(`Shell command "${cmd}" failed with exit code ${execResult.code}. Stderr: ${execResult.stderr}`);
        }

        return { success: true, stdout: execResult.stdout };
      }

      case 'git': {
        const branchName = `opencode/exec-${context.executionId.slice(0, 8)}`;
        const commitMsg = step.config.commitMessage || `opencode: changes from execution ${context.executionId}`;
        
        await this.log(context.executionId, 'info', `Creating branch: ${branchName}`);
        await this.git.createBranch(targetLocalPath, branchName);
        context.currentBranch = branchName;

        await this.log(context.executionId, 'info', `Committing changes...`);
        await this.git.commitChanges(targetLocalPath, commitMsg);

        // Push if github_token is present
        const githubToken = targetProject
          ? await this.secrets.getSecret(targetProject.id, 'github_token') || ''
          : '';
        if (githubToken) {
          const pushLog = targetProject
            ? await this.redactSecrets(`Pushing branch ${branchName} to remote repository.`, targetProject.id)
            : `Pushing branch ${branchName} to remote repository.`;
          await this.log(context.executionId, 'info', pushLog);
          await this.git.push(targetLocalPath, branchName, githubToken);
        }

        return { success: true, branch: branchName };
      }

      case 'pr': {
        const githubToken = targetProject
          ? await this.secrets.getSecret(targetProject.id, 'github_token')
          : null;
        if (!githubToken) {
          throw new Error('github_token secret is not configured for this project.');
        }

        const prTitle = step.config.title || `OpenCode automatic fix: execution ${context.executionId}`;
        const prBody = step.config.body || `OpenCode executed workflow and proposed changes.\n\nExecution ID: ${context.executionId}`;
        const headBranch = context.currentBranch || `opencode/exec-${context.executionId.slice(0, 8)}`;
        const baseBranch = targetProject ? targetProject.baseBranch : 'main';

        const prLog = targetProject
          ? await this.redactSecrets(`Creating GitHub Pull Request from "${headBranch}" into "${baseBranch}"`, targetProject.id)
          : `Creating GitHub Pull Request from "${headBranch}" into "${baseBranch}"`;
        await this.log(context.executionId, 'info', prLog);
        const pr = await this.git.createPullRequest({
          localPath: targetLocalPath,
          title: prTitle,
          body: prBody,
          headBranch,
          baseBranch,
          githubToken
        });

        const prOpenedLog = targetProject
          ? await this.redactSecrets(`Pull Request opened: ${pr.prUrl}`, targetProject.id)
          : `Pull Request opened: ${pr.prUrl}`;
        await this.log(context.executionId, 'info', prOpenedLog);
        return pr;
      }

      case 'approval':
        return { success: true, waiting: true };

      case 'nosql': {
        const databaseId = step.config.databaseId;
        const collection = step.config.collection;
        const operation = step.config.operation || 'find';
        
        if (!databaseId) {
          throw new Error('Database ID is required for NoSQL step.');
        }
        if (!collection) {
          throw new Error('Collection name is required for NoSQL step.');
        }

         const db = await this.store.get<any>('databases', databaseId);
        if (!db) {
          throw new Error(`Database with ID "${databaseId}" not found.`);
        }

        let docId = step.config.documentId ? this.interpolateString(step.config.documentId, context) : '';
        let data = step.config.data;
        if (data !== undefined && data !== null) {
          data = this.interpolateValue(data, context);
        }

        let result: any = null;

        await this.log(context.executionId, 'info', `Executing NoSQL operation: ${operation} on DB: ${databaseId}, Collection: ${collection}`);

         if (operation === 'find') {
           result = docId
             ? await this.noSqlDocuments.get(databaseId, collection, docId)
             : await this.noSqlDocuments.list(databaseId, collection);
        } else if (operation === 'insert') {
          if (!docId) {
            docId = (data && data.id) ? String(data.id) : `doc_${Math.floor(10000 + Math.random() * 90000)}`;
          }
          if (data && typeof data === 'object') {
            data.id = docId;
          } else if (data === undefined || data === null) {
            data = { id: docId };
          }
           const mergedDoc = await this.noSqlDocuments.upsert(databaseId, collection, { ...data, id: docId });
           result = mergedDoc;
        } else if (operation === 'update') {
          if (!docId) {
            throw new Error('Document ID is required for update operation.');
          }
           const existingDoc = await this.noSqlDocuments.get<any>(databaseId, collection, docId) || {};
          
          let parsedData = data;
          if (typeof data === 'string') {
            try {
              parsedData = JSON.parse(data);
            } catch (err) {
              // keep as is
            }
          }
          let updatedDoc = parsedData;
          if (parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
            updatedDoc = { ...existingDoc, ...parsedData, id: docId };
          } else {
            updatedDoc = { ...existingDoc, value: parsedData, id: docId };
          }
           await this.noSqlDocuments.upsert(databaseId, collection, updatedDoc);
           result = updatedDoc;
        } else if (operation === 'delete') {
          if (!docId) {
            throw new Error('Document ID is required for delete operation.');
          }
          let deleted = false;
           const existing = await this.noSqlDocuments.get(databaseId, collection, docId);
           if (existing) {
             await this.noSqlDocuments.delete(databaseId, collection, docId);
             deleted = true;
          }
          result = { deleted, id: docId };
        } else {
          throw new Error(`Unsupported NoSQL operation: ${operation}`);
        }

        await this.log(context.executionId, 'info', `NoSQL DB operation "${operation}" on database "${databaseId}", collection "${collection}" completed successfully.`);
        return { success: true, result };
      }

      case 'transform': {
        const template = step.config.template || '';
        const outputText = this.interpolateString(template, context);
        return { success: true, outputText };
      }

      case 'output': {
        const outputType = step.config.outputType; // 'file' | 'http' | 'webhook' | 'notification' | 'firebase'
        const data = this.interpolateValue(step.config.data, context);

        if (outputType === 'file') {
          const relativeFilePath = step.config.filePath;
          const absolutePath = await this.resolveWorkspacePath(targetLocalPath, relativeFilePath, 'File output');

          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
          await fs.writeFile(absolutePath, typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
          context.artifacts.push(absolutePath);
          await this.log(context.executionId, 'info', `Saved file artifact: ${relativeFilePath}`);
        } else if (outputType === 'http' || outputType === 'webhook' || outputType === 'notification') {
          const method = (String(step.config.method || 'POST')).toUpperCase();
          const url = this.interpolateString(String(step.config.url || ''), context);
          // Interpolate headers and resolve {{secrets.KEY}} references via the secret store.
          const headers = await this.resolveSecretReferences(
            this.interpolateValue(step.config.headers || {}, context),
            targetProject?.id
          );
          const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
          const body = hasBody ? this.interpolateValue(step.config.body, context) : undefined;

          if (!url) {
            throw new Error('HTTP output requires a "url" in config.');
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);

          try {
            const init: RequestInit = {
              method,
              headers: { 'Content-Type': 'application/json', ...(headers as Record<string, string>) },
              signal: controller.signal
            };
            if (hasBody && body !== undefined) {
              init.body = typeof body === 'string' ? body : JSON.stringify(body);
            }

            await this.log(context.executionId, 'info', `HTTP output: ${method} ${url}`);
            const res = await fetch(url, init);
             const rawBody = await readResponseTextLimited(res, DEFAULT_CAPTURE_BYTES);

            let responseBody: any = rawBody;
            if (rawBody) {
              try {
                responseBody = JSON.parse(rawBody);
              } catch {
                responseBody = rawBody;
              }
            }

            await this.log(context.executionId, 'info', `HTTP output ${method} ${url} responded with status ${res.status}`);

            if (!res.ok) {
              throw new Error(`HTTP output ${method} ${url} failed with status ${res.status}: ${rawBody}`);
            }

            if (outputType === 'notification') {
              await this.log(context.executionId, 'info', 'Notification sent.');
            }

            return { success: true, statusCode: res.status, responseBody };
          } catch (err: any) {
            if (err.name === 'AbortError') {
              throw new Error(`HTTP output ${method} ${url} timed out after 15s.`);
            }
            throw err;
          } finally {
            clearTimeout(timeout);
          }
        } else if (outputType === 'firebase') {
          const collection = step.config.collection;
          const docId = step.config.docId;
          const firestoreUrl = this.interpolateString(String(step.config.firestoreUrl || ''), context);
          if (!collection || !docId || (!firestoreUrl && !step.config.gcpProject)) {
            throw new Error('Firebase output requires configuration: collection, docId and firestoreUrl (or gcpProject).');
          }

          const url = firestoreUrl
            || `https://firestore.googleapis.com/v1/projects/${step.config.gcpProject}/databases/(default)/documents/${collection}/${docId}`;
          // Credentials must come through {{secrets.KEY}} references, never hardcoded.
          const headers = await this.resolveSecretReferences(
            this.interpolateValue(step.config.headers || {}, context),
            targetProject?.id
          );

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);

          try {
            const init: RequestInit = {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', ...(headers as Record<string, string>) },
              body: JSON.stringify({ fields: this.toFirestoreFields(data) }),
              signal: controller.signal
            };

            await this.log(context.executionId, 'info', `Firestore write to collection "${collection}" doc "${docId}".`);
            const res = await fetch(url, init);
             const rawBody = await readResponseTextLimited(res, DEFAULT_CAPTURE_BYTES);

            if (!res.ok) {
              throw new Error(`Firestore write failed with status ${res.status}: ${rawBody}`);
            }

            await this.log(context.executionId, 'info', 'Firestore document written.');
            return { success: true, statusCode: res.status };
          } catch (err: any) {
            if (err.name === 'AbortError') {
              throw new Error('Firestore write timed out after 15s.');
            }
            throw err;
          } finally {
            clearTimeout(timeout);
          }
        } else {
          throw new Error(`Output adapter type "${outputType}" is not supported. Configured output types: file, http, webhook, notification, firebase.`);
        }

        return { success: true };
      }

      case 'http_request': {
        const method = (String(step.config.method || 'GET')).toUpperCase();
        const url = this.interpolateString(String(step.config.url || ''), context);
        let headers = this.interpolateValue(step.config.headers || {}, context);
        headers = await this.resolveSecretReferences(headers, targetProject?.id);

        const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
        let body = step.config.body;
        if (body !== undefined && body !== null) {
          body = this.interpolateValue(body, context);
        }

        const authType = step.config.authType;
        if (authType === 'bearer') {
          let bearerToken = step.config.bearerToken || '';
          bearerToken = this.interpolateString(bearerToken, context);
          bearerToken = await this.resolveSecretReferences(bearerToken, targetProject?.id);
          headers = {
            ...headers,
            'Authorization': `Bearer ${bearerToken}`
          };
        }

        if (!url) {
          throw new Error('HTTP Request step requires a "url" in config.');
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        if (signal) {
          if (signal.aborted) {
            controller.abort();
          } else {
            signal.addEventListener('abort', () => controller.abort(), { once: true });
          }
        }

        try {
          const init: RequestInit = {
            method,
            headers: { 'Content-Type': 'application/json', ...(headers as Record<string, string>) },
            signal: controller.signal
          };
          if (hasBody && body !== undefined && body !== null) {
            init.body = typeof body === 'string' ? body : JSON.stringify(body);
          }

          await this.log(context.executionId, 'info', `HTTP Request: ${method} ${url}`);
          const res = await fetch(url, init);
           const rawBody = await readResponseTextLimited(res, DEFAULT_CAPTURE_BYTES);

          let responseBody: any = rawBody;
          if (rawBody) {
            try {
              responseBody = JSON.parse(rawBody);
            } catch {
              responseBody = rawBody;
            }
          }

          const recordOfHeaders: Record<string, string> = {};
          res.headers.forEach((value, key) => {
            recordOfHeaders[key] = value;
          });

          await this.log(context.executionId, 'info', `HTTP Request ${method} ${url} responded with status ${res.status}`);

          if (!res.ok) {
            throw new Error(`HTTP Request ${method} ${url} failed with status ${res.status}: ${rawBody}`);
          }

          return { success: true, statusCode: res.status, headers: recordOfHeaders, responseBody };
        } catch (err: any) {
          if (err.name === 'AbortError') {
            throw new Error(`HTTP Request ${method} ${url} timed out after 15s.`);
          }
          throw err;
        } finally {
          clearTimeout(timeout);
        }
      }

      case 'python':
        return this.executePythonNode(step.config || {}, context, targetLocalPath, signal);

      case 'json_parser':
        return this.executeJsonParserNode(step.config || {}, context);

      case 'code': {
        const language = step.config.language;
        const code = step.config.code || '';

        if (language === 'javascript') {
          const scriptContext = {
            context: {
              triggerPayload: context.triggerPayload,
              stepOutputs: context.stepOutputs,
              variables: context.variables
            },
            console: {
              log: (...args: any[]) => this.log(context.executionId, 'info', `[Code Node JS] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`)
            },
            fetch: fetch,
            opencode: {
              db: {
                find: async (databaseId: string, collection: string, docId?: string) => {
                   return docId
                     ? this.noSqlDocuments.get(databaseId, collection, docId)
                     : this.noSqlDocuments.list(databaseId, collection);
                },
                insert: async (databaseId: string, collection: string, docId: string | null, data: any) => {
                   const finalDocId = docId || (data && data.id) ? String(docId || data.id) : `doc_${Math.floor(10000 + Math.random() * 90000)}`;
                   return this.noSqlDocuments.upsert(databaseId, collection, { ...data, id: finalDocId });
                },
                update: async (databaseId: string, collection: string, docId: string, data: any) => {
                   const db = await this.store.get<any>('databases', databaseId);
                   if (!db) throw new Error(`Database with ID "${databaseId}" not found.`);
                   return this.noSqlDocuments.upsert(databaseId, collection, { ...(await this.noSqlDocuments.get<any>(databaseId, collection, docId) || {}), ...data, id: docId });
                },
                delete: async (databaseId: string, collection: string, docId: string) => {
                   const existing = await this.noSqlDocuments.get(databaseId, collection, docId);
                   if (!existing) return false;
                   await this.noSqlDocuments.delete(databaseId, collection, docId);
                   return true;
                }
              }
            }
          };

          // Keep expression-oriented scripts backwards compatible. If the
          // script uses a top-level `return`, retry it inside a function because
          // vm.runInNewContext evaluates the first form as a plain script.
          let executionResult: any;
          try {
            executionResult = vm.runInNewContext(code, scriptContext, { timeout: 5000 });
          } catch (err: any) {
            if (err?.name !== 'SyntaxError' || !/Illegal return statement/.test(err.message || '')) {
              throw err;
            }
            const wrappedCode = `(async function () {\n${code}\n})()`;
            executionResult = vm.runInNewContext(wrappedCode, scriptContext, { timeout: 5000 });
          }
          if (executionResult && typeof executionResult.then === 'function') {
            executionResult = await executionResult;
          }

          if (scriptContext.context && typeof scriptContext.context.variables === 'object' && scriptContext.context.variables !== null) {
            Object.assign(context.variables, scriptContext.context.variables);
          }

          return { success: true, result: executionResult };
        } else if (language === 'python') {
          return this.executePythonNode({ ...step.config, code, source: step.config.source || 'inline' }, context, targetLocalPath, signal);
          /*
          Legacy implementation retained below only as a reference for persisted
          workflows during this migration. The common runner above handles both
          inline and file-based Python with stdin/stdout and cancellation.
          */
        } else if (language === 'legacy-python-disabled') {
          const pythonCode = `# -*- coding: utf-8 -*-
import sys, json
input_file = sys.argv[1]
with open(input_file, 'r', encoding='utf-8') as f:
    context = json.load(f)

# --- USER CODE START ---
${code}
# --- USER CODE END ---

output = {
    "variables": context.get("variables", {}),
    "result": locals().get("result", None)
}
print("OPENCODE_JSON_OUTPUT:" + json.dumps(output))
`;

          const tempDir = os.tmpdir();
          const timestamp = Date.now();
          const inputFilePath = path.join(tempDir, `opencode_input_${timestamp}.json`);
          const scriptFilePath = path.join(tempDir, `opencode_script_${timestamp}.py`);

          await fs.writeFile(inputFilePath, JSON.stringify({
            triggerPayload: context.triggerPayload,
            stepOutputs: context.stepOutputs,
            variables: context.variables
          }), 'utf8');

          await fs.writeFile(scriptFilePath, pythonCode, 'utf8');

          const runPythonProcess = (cmd: string): Promise<{ stdout: string; stderr: string; code: number | null; error?: Error }> => {
            return new Promise((resolve) => {
              const proc = spawn(cmd, [scriptFilePath, inputFilePath]);
              let stdout = '';
              let stderr = '';
              
              proc.stdout.on('data', (data) => {
                stdout += data.toString();
              });
              proc.stderr.on('data', (data) => {
                stderr += data.toString();
              });
              proc.on('error', (err) => {
                resolve({ stdout, stderr, code: null, error: err });
              });
              proc.on('close', (code) => {
                resolve({ stdout, stderr, code });
              });
            });
          };

          let runResult = await runPythonProcess('python3');
          if (runResult.error && (runResult.error as any).code === 'ENOENT') {
            runResult = await runPythonProcess('python');
          }

          try {
            await fs.unlink(inputFilePath);
            await fs.unlink(scriptFilePath);
          } catch (cleanupErr) {
            // ignore
          }

          if (runResult.error) {
            throw new Error(`Python interpreter not found. Please ensure python3 or python is installed and in the system PATH. Error details: ${runResult.error.message}`);
          }

          if (runResult.code !== 0) {
            throw new Error(`Python execution failed with exit code ${runResult.code}. Error: ${runResult.stderr}`);
          }

          const match = runResult.stdout.match(/OPENCODE_JSON_OUTPUT:([\s\S]*)/);
          if (!match) {
            throw new Error(`Python execution completed but did not return the expected output format. Output: ${runResult.stdout}`);
          }

          let parsedJsonOutput: any;
          try {
            parsedJsonOutput = JSON.parse(match[1].trim());
          } catch (parseErr) {
            throw new Error(`Failed to parse Python execution output: ${parseErr}. Raw output: ${match[1]}`);
          }

          if (parsedJsonOutput.variables && typeof parsedJsonOutput.variables === 'object') {
            Object.assign(context.variables, parsedJsonOutput.variables);
          }

          return { success: true, result: parsedJsonOutput.result };
        } else {
          throw new Error(`Unsupported programming language for code step: ${language}`);
        }
      }

      case 'discord_notify': {
        const webhookUrl = this.interpolateString(step.config.webhookUrl || '', context);
        let message = step.config.message || '';
        message = this.interpolateString(message, context);
        const resolvedUrl = await this.resolveSecretReferences(webhookUrl, targetProject?.id);

        if (!resolvedUrl) {
          throw new Error('Discord Notify step requires a "webhookUrl" in config.');
        }
        if (!message) {
          throw new Error('Discord Notify step requires a "message" in config.');
        }

        await this.log(context.executionId, 'info', `Sending Discord notification to webhook.`);
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        try {
          const res = await fetch(resolvedUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: message }),
            signal: controller.signal
          });

          if (!res.ok) {
             const rawBody = await readResponseTextLimited(res, DEFAULT_CAPTURE_BYTES);
            throw new Error(`Discord Notify failed with status ${res.status}: ${rawBody}`);
          }

          await this.log(context.executionId, 'info', `Discord notification sent successfully.`);
          return { success: true };
        } catch (err: any) {
          if (err.name === 'AbortError') {
            throw new Error(`Discord Notify timed out after 15s.`);
          }
          throw err;
        } finally {
          clearTimeout(timeout);
        }
      }

      case 'google_sheets': {
        const spreadsheetId = this.interpolateString(step.config.spreadsheetId || '', context);
        const range = this.interpolateString(step.config.range || '', context);
        const operation = step.config.operation || 'append';
        let values = step.config.values;
        if (typeof values === 'string') {
          values = this.interpolateValue(values, context);
        }

        if (!spreadsheetId) {
          throw new Error('Google Sheets step requires a "spreadsheetId" in config.');
        }
        if (!range) {
          throw new Error('Google Sheets step requires a "range" in config.');
        }

        const token = targetProject
          ? await this.secrets.getSecret(targetProject.id, 'google_sheets_token') || await this.secrets.getSecret(targetProject.id, 'google_token') || ''
          : '';

        await this.log(context.executionId, 'info', `Executing Google Sheets operation "${operation}" on sheet "${spreadsheetId}" and range "${range}".`);

        if (!token) {
          await this.log(context.executionId, 'warn', `No google_sheets_token or google_token found in secrets. Simulating Google Sheets operation.`);
          return {
            success: true,
            simulated: true,
            spreadsheetId,
            range,
            operation,
            values
          };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        try {
          let url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
          let method = 'GET';
          let body: any = undefined;

          if (operation === 'append') {
            url += ':append?valueInputOption=USER_ENTERED';
            method = 'POST';
            body = { values: Array.isArray(values) ? values : [values] };
          } else if (operation === 'update') {
            url += '?valueInputOption=USER_ENTERED';
            method = 'PUT';
            body = { values: Array.isArray(values) ? values : [values] };
          }

          const init: RequestInit = {
            method,
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            signal: controller.signal
          };

          if (body) {
            init.body = JSON.stringify(body);
          }

          const res = await fetch(url, init);
             const rawBody = await readResponseTextLimited(res, DEFAULT_CAPTURE_BYTES);

          if (!res.ok) {
            throw new Error(`Google Sheets API failed with status ${res.status}: ${rawBody}`);
          }

          let responseBody = rawBody;
          try {
            responseBody = JSON.parse(rawBody);
          } catch {
            // keep as text
          }

          await this.log(context.executionId, 'info', `Google Sheets operation "${operation}" completed successfully.`);
          return { success: true, result: responseBody };
        } catch (err: any) {
          if (err.name === 'AbortError') {
            throw new Error(`Google Sheets operation timed out after 15s.`);
          }
          throw err;
        } finally {
          clearTimeout(timeout);
        }
      }

      default:
        throw new Error(`Unsupported workflow step type: ${step.type}`);
    }
  }

  private evaluateExpression(expr: string, context: any): any {
    // Normalize the `context.` prefix: both `{{triggerPayload.x}}` and
    // `{{context.triggerPayload.x}}` should resolve against the same context object.
    let normalized = expr.trim();
    if (normalized.startsWith('context.')) {
      normalized = normalized.slice('context.'.length);
    }
    const isPath = normalized.startsWith('$.') || (context && typeof context === 'object' && normalized.split('.')[0] in context);
    if (isPath) {
      const path = (normalized.startsWith('$.') ? normalized.slice(2) : normalized).split('.');
      let obj = context;
      for (const key of path) {
        if (!obj) return undefined;
        obj = obj[key];
      }
      return obj;
    }
    return expr;
  }

  private static readonly UNSAFE_TOKEN_RE = /\b(process|require|module|global|fetch|setTimeout|eval|Function|import|export|this|window|document|constructor|__proto__|prototype)\b/;

  private static readonly SAFE_HELPERS: Record<string, (...args: any[]) => any> = {
    includes: (container: any, value: any) => {
      if (Array.isArray(container) || typeof container === 'string') return container.includes(value);
      if (container && typeof container === 'object') return value in container;
      return false;
    },
    length: (container: any) => (container ? container.length : 0),
    upper: (value: any) => String(value).toUpperCase(),
    lower: (value: any) => String(value).toLowerCase(),
    trim: (value: any) => String(value).trim(),
    json: (value: any) => JSON.stringify(value),
    toString: (value: any) => String(value),
    number: (value: any) => Number(value)
  };

  private evaluateJSExpression(expression: string, context: any): boolean {
    try {
      const expr = String(expression ?? '');
      // Simple lexical validation: reject expressions referencing dangerous globals/tokens.
      // The evaluator only exposes `context` and the whitelisted `helpers` object.
      if (WorkflowExecutor.UNSAFE_TOKEN_RE.test(expr)) {
        console.warn(`Expression evaluation rejected (unsafe token detected): "${expr}"`);
        return false;
      }
      const fn = new Function('context', 'helpers', `return !!(${expr});`);
      return fn(context, WorkflowExecutor.SAFE_HELPERS);
    } catch (err) {
      console.error('Expression evaluation failed:', err);
      return false;
    }
  }

  private interpolateString(template: string, context: any): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, match) => {
      const val = this.evaluateExpression(match.trim(), context);
      return val !== undefined ? String(val) : '';
    });
  }

  private interpolateValue(value: any, context: any): any {
    if (typeof value === 'string') {
      const exact = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
      if (exact) return this.evaluateExpression(exact[1], context);
      if (value.startsWith('$.')) return this.evaluateExpression(value, context);
      return this.interpolateString(value, context);
    }
    if (Array.isArray(value)) {
      return value.map(val => this.interpolateValue(val, context));
    }
    if (value !== null && typeof value === 'object') {
      const res: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        res[k] = this.interpolateValue(v, context);
      }
      return res;
    }
    return value;
  }

  /**
   * Resolves `{{secrets.KEY}}` references inside a value using the secret store
   * for the given project. Never logs the resolved values. Unresolvable keys
   * resolve to the empty string so no secret placeholder leaks into requests.
   */
  private async resolveSecretReferences(value: any, projectId: string | undefined): Promise<any> {
    if (typeof value === 'string') {
      if (!value.includes('{{secrets.')) return value;
      let result = value;
      const matches = Array.from(result.matchAll(/\{\{\s*secrets\.([\w.-]+)\s*\}\}/g));
      for (const match of matches) {
        const secret = projectId ? await this.secrets.getSecret(projectId, match[1]) : null;
        result = result.replace(match[0], secret || '');
      }
      return result;
    }
    if (Array.isArray(value)) {
      const out: any[] = [];
      for (const v of value) out.push(await this.resolveSecretReferences(v, projectId));
      return out;
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) out[k] = await this.resolveSecretReferences(v, projectId);
      return out;
    }
    return value;
  }

  // Converts a plain JS value to Firestore REST "Value" format.
  private toFirestoreValue(value: any): any {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: String(value) };
    }
    if (typeof value === 'string') return { stringValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(v => this.toFirestoreValue(v)) } };
    if (typeof value === 'object') return { mapValue: { fields: this.toFirestoreFields(value) } };
    return { stringValue: String(value) };
  }

  // Converts a plain JS object to Firestore REST "Fields" format.
  private toFirestoreFields(value: any): Record<string, any> {
    const fields: Record<string, any> = {};
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) {
        fields[k] = this.toFirestoreValue(v);
      }
      return fields;
    }
    return { value: this.toFirestoreValue(value) };
  }

  private async resolveWorkspacePath(workspace: string, requested: string, label: string): Promise<string> {
    if (!workspace) throw new Error(`${label} requires a project workspace.`);
    await fs.mkdir(workspace, { recursive: true });
    const root = await fs.realpath(workspace);
    const candidate = path.resolve(root, requested);
    let realCandidate: string;
    try {
      realCandidate = await fs.realpath(candidate);
    } catch {
      let existingParent = path.dirname(candidate);
      const missingParts: string[] = [path.basename(candidate)];
      while (existingParent !== root) {
        try {
          const realParent = await fs.realpath(existingParent);
          realCandidate = path.join(realParent, ...missingParts.reverse());
          break;
        } catch {
          missingParts.push(path.basename(existingParent));
          existingParent = path.dirname(existingParent);
        }
      }
      if (!realCandidate!) realCandidate = path.join(root, ...missingParts.reverse());
    }
    const relative = path.relative(root, realCandidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Security Violation: ${label} path "${requested}" lies outside project workspace.`);
    }
    return realCandidate;
  }

  private parseJsonOutput(stdout: string, label: string): any {
    const marked = stdout.match(/OPENCODE_JSON_OUTPUT:\s*([\s\S]*)/);
    const candidates = marked ? [marked[1].trim()] : [stdout.trim()];
    if (!marked) {
      const lines = stdout.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      candidates.push(...lines.reverse());
    }
    for (const candidate of candidates) {
      try { return JSON.parse(candidate); } catch { /* try the next clean/marked candidate */ }
    }
    throw new Error(`${label} did not return valid JSON. Output: ${stdout.slice(-2000)}`);
  }

  private async executePythonNode(config: Record<string, any>, context: any, workspace: string, signal?: AbortSignal): Promise<any> {
    const source = config.source === 'file' || config.filePath ? 'file' : 'inline';
    let scriptPath: string;
    let temporary = false;
    if (source === 'file') {
      const requested = this.interpolateString(String(config.filePath || ''), context);
      if (!requested || path.extname(requested).toLowerCase() !== '.py') {
        throw new Error('Python file source requires a .py filePath.');
      }
      scriptPath = await this.resolveWorkspacePath(workspace, requested, 'Python script');
      if (!existsSync(scriptPath)) throw new Error(`Python script not found: ${requested}`);
    } else {
      const runtimeDir = await this.resolveWorkspacePath(workspace, '.opencode-runtime', 'Python runtime');
      await fs.mkdir(runtimeDir, { recursive: true });
      scriptPath = path.join(runtimeDir, `python-${context.executionId}-${Date.now()}.py`);
      temporary = true;
      const code = String(config.code || '');
      const wrapper = `# -*- coding: utf-8 -*-\nimport json, sys\ncontext = json.load(sys.stdin)\n${code}\nprint("OPENCODE_JSON_OUTPUT:" + json.dumps({"variables": context.get("variables", {}), "result": locals().get("result", None)}))\n`;
      await fs.writeFile(scriptPath, wrapper, 'utf8');
    }

    const input = JSON.stringify({
      executionId: context.executionId,
      triggerPayload: context.triggerPayload,
      stepOutputs: context.stepOutputs,
      variables: context.variables
    });
    const timeoutMs = Math.min(Math.max(Number(config.timeoutMs || 30000), 1), 300000);
    try {
       const rawArgs = this.interpolateValue(config.args, context);
       const args = Array.isArray(rawArgs) ? rawArgs.map(String) : rawArgs === undefined || rawArgs === '' ? [] : [String(rawArgs)];
       let result = await this.spawnStructuredProcess('python3', [scriptPath, ...args], workspace, input, timeoutMs, signal);
       if (result.error?.code === 'ENOENT') {
         result = await this.spawnStructuredProcess('python', [scriptPath, ...args], workspace, input, timeoutMs, signal);
      }
      if (result.error) throw new Error(`Python interpreter not found. Please ensure python3 or python is installed in the system PATH. Error details: ${result.error.message}`);
      if (result.code !== 0) throw new Error(`Python execution failed with exit code ${result.code}. Stderr: ${result.stderr}`);
      const parsed = this.parseJsonOutput(result.stdout, 'Python execution');
      if (parsed?.variables && typeof parsed.variables === 'object') Object.assign(context.variables, parsed.variables);
      return { success: true, result: parsed?.result ?? parsed, stdout: result.stdout, stderr: result.stderr };
    } finally {
      if (temporary) await fs.rm(scriptPath, { force: true }).catch(() => undefined);
    }
  }

  private async executeJsonParserNode(config: Record<string, any>, context: any): Promise<any> {
    let input = config.input;
    if (input === undefined && typeof config.inputExpr === 'string') input = this.evaluateExpression(config.inputExpr, context);
    if (input === undefined && typeof config.sourceStepId === 'string') input = context.stepOutputs?.[config.sourceStepId];
    if (input === undefined) input = context.stepOutputs;
    input = this.interpolateValue(input, context);
    let parsed: any = input;
    if (typeof input === 'string') {
      try { parsed = JSON.parse(input); } catch (err) {
        if (config.allowText === false) throw new Error(`JSON parser could not parse input as JSON: ${String(err)}`);
      }
    }
     const selected = this.selectJsonPath(parsed, config.path || config.selectPath || config.jsonPath);
     const operation = config.operation || (config.mapping || config.rowsPath ? 'rows' : 'parse');
     if (operation === 'parse') return { success: true, data: selected, result: selected };
     if (operation === 'extract') return { success: true, data: selected, result: selected };
     if (operation !== 'rows') throw new Error(`Unsupported JSON parser operation: ${operation}`);
    const rowsValue = this.selectJsonPath(selected, config.rowsPath || config.arrayPath);
    const rowsSource = Array.isArray(rowsValue) ? rowsValue : (Array.isArray(selected) ? selected : [selected]);
    const mapping = config.mapping || config.fieldMap || {};
    const rows = Object.keys(mapping).length > 0
      ? rowsSource.map((row: any) => Object.fromEntries(Object.entries(mapping).map(([key, expr]) => [key, this.selectJsonPath(row, String(expr))])))
      : rowsSource;
    return { success: true, data: selected, result: selected, rows, count: rows.length };
  }

  private selectJsonPath(value: any, expression: any): any {
    if (!expression) return value;
    const normalized = String(expression).replace(/^\$\.?/, '');
    if (!normalized) return value;
    return normalized.split(/[.[\]]+/).filter(Boolean).reduce((current, key) => current == null ? undefined : current[key], value);
  }

  private spawnStructuredProcess(
    command: string,
    args: string[],
    cwd: string,
    stdin: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<{ stdout: string; stderr: string; code: number | null; error?: NodeJS.ErrnoException }> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, { cwd, stdio: 'pipe' });
      let stdout = '';
      let stderr = '';
      const maxCaptureBytes = Number(process.env.PYTHON_MAX_OUTPUT_BYTES) > 0 ? Number(process.env.PYTHON_MAX_OUTPUT_BYTES) : DEFAULT_CAPTURE_BYTES;
      let settled = false;
      const finish = (value: { stdout: string; stderr: string; code: number | null; error?: NodeJS.ErrnoException }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const kill = (message: string) => {
        try { proc.kill('SIGKILL'); } catch { /* process already exited */ }
        finish({ stdout, stderr: `${stderr}\n${message}`, code: -1 });
      };
      const timer = setTimeout(() => kill(signal?.aborted ? 'Process aborted due to cancellation.' : `Process timed out after ${timeoutMs}ms.`), timeoutMs);
      if (signal) {
        if (signal.aborted) kill('Process aborted due to cancellation.');
        else signal.addEventListener('abort', () => kill('Process aborted due to cancellation.'), { once: true });
      }
       proc.stdout.on('data', data => { stdout = limitedText(stdout + data.toString(), maxCaptureBytes); });
       proc.stderr.on('data', data => { stderr = limitedText(stderr + data.toString(), maxCaptureBytes); });
      proc.on('error', error => finish({ stdout, stderr, code: null, error: error as NodeJS.ErrnoException }));
      proc.on('close', code => finish({ stdout, stderr, code }));
      proc.stdin.end(stdin);
    });
  }

  private executeShell(cmd: string, cwd: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
      if (cwd && !existsSync(cwd)) {
        mkdirSync(cwd, { recursive: true });
      }
    } catch (err) {
      console.log('[executeShell] no se pudo asegurar cwd:', cwd, err);
    }

    return new Promise((resolve) => {
      let proc: ChildProcessWithoutNullStreams;

      if (process.platform === 'win32') {
        const candidates = [
          process.env.ComSpec,
          'C:\\WINDOWS\\system32\\cmd.exe',
          'C:\\Windows\\System32\\cmd.exe',
          'C:\\Windows\\cmd.exe',
          'cmd.exe'
        ].filter((c): c is string => !!c);
        const shellPath = candidates.find((c) => existsSync(c)) || 'cmd.exe';
        if (!shellDiagnosticLogged) {
          console.log('[executeShell] using shell:', shellPath);
          shellDiagnosticLogged = true;
        }
        proc = spawn(shellPath, ['/d', '/s', '/c', cmd], { cwd });
      } else {
        proc = spawn(cmd, [], { cwd, shell: true });
      }

      let settled = false;
      const done = (code: number, errMsg?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (errMsg) {
          resolve({ stdout, stderr: stderr + `\n${errMsg}`, code });
        } else {
          resolve({ stdout, stderr, code });
        }
      };

      let stdout = '';
      let stderr = '';
      const maxCaptureBytes = Number(process.env.SHELL_MAX_OUTPUT_BYTES) > 0 ? Number(process.env.SHELL_MAX_OUTPUT_BYTES) : DEFAULT_CAPTURE_BYTES;

      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // process already gone
        }
        if (signal?.aborted) {
          done(-1, 'Command aborted due to cancellation.');
        } else {
          done(-1, 'timed out after 30s. Command killed.');
        }
      }, 30000);

      if (signal) {
        if (signal.aborted) {
          try {
            proc.kill('SIGKILL');
          } catch {
            // process already gone
          }
          done(-1, 'Command aborted due to cancellation.');
        } else {
          signal.addEventListener('abort', () => {
            try {
              proc.kill('SIGKILL');
            } catch {
              // process already gone
            }
            done(-1, 'Command aborted due to cancellation.');
          }, { once: true });
        }
      }

      proc.stdout.on('data', (data: Buffer) => { stdout = limitedText(stdout + data.toString(), maxCaptureBytes); });
      proc.stderr.on('data', (data: Buffer) => { stderr = limitedText(stderr + data.toString(), maxCaptureBytes); });

      proc.on('error', (err: Error) => {
        done(-1, `Error spawning process: ${err.message}`);
      });

      proc.on('close', (code: number | null) => {
        done(code ?? -1);
      });
    });
  }

  // In-memory cache of plaintext secret values per project (never persisted).
  private async getProjectSecrets(projectId: string | undefined): Promise<string[]> {
    if (!projectId) return [];
    const cached = this.secretCache.get(projectId);
    if (cached && Date.now() - cached.cachedAt < SECRET_CACHE_TTL_MS) return cached.values;

    const secretsList = await this.store.list<any>('secrets', (s) => s.projectId === projectId);
    const values: string[] = [];
    for (const secret of secretsList) {
      const decrypted = await this.secrets.getSecret(projectId, secret.id.replace(`${projectId}_`, ''));
      if (decrypted && decrypted.length > 5) {
        values.push(decrypted);
      }
    }
    if (this.secretCache.size >= MAX_SECRET_CACHE_PROJECTS && !this.secretCache.has(projectId)) {
      const oldest = this.secretCache.keys().next().value;
      if (oldest) this.secretCache.delete(oldest);
    }
    this.secretCache.set(projectId, { values: values.slice(0, 100), cachedAt: Date.now() });
    return values;
  }

  invalidateProjectSecrets(projectId: string): void {
    this.secretCache.delete(projectId);
  }

  private async redactSecrets(text: string, projectId: string | undefined): Promise<string> {
    const secrets = await this.getProjectSecrets(projectId);
    let redactedText = text;
    for (const decrypted of secrets) {
      // Escape regex special chars
      const escaped = decrypted.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      redactedText = redactedText.replace(new RegExp(escaped, 'g'), '[REDACTED]');
    }
    return redactedText;
  }
}
