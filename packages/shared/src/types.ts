export interface Project {
  id: string; // Unique slug or UUID
  name: string;
  localPath: string; // Absolute path to the local repository folder
  gitRemoteUrl: string; // Git remote URL (e.g. git@github.com:user/repo.git)
  baseBranch: string; // Default branch (e.g. 'main', 'master')
  allowedCommands: string[]; // List of shell command prefixes allowed to run (e.g. ['npm test', 'pytest'])
  policy: {
    maxExecutionTimeSeconds: number;
    concurrencyMode: 'serialize' | 'reject'; // Serialize: queue up; Reject: drop event if busy
    requireApprovalForDestructiveActions: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Connection {
  id: string; // Unique public slug or ID
  name: string;
  projectId?: string;
  workflowId: string;
  tokenHash: string; // Salted hash of the Bearer token used for verification
  createdAt: string;
  updatedAt: string;
  // Authentication mode for this webhook connection (Fase 1, mejora B1).
  // 'bearer' (default, retrocompatible): verifies `Authorization: Bearer <token>`.
  // 'hmac': verifies an HMAC-SHA256 signature over the body with timestamp + nonce.
  authType?: 'bearer' | 'hmac';
  // Hash of the shared HMAC secret (only relevant when authType === 'hmac').
  // The raw secret is returned exactly once at creation time and never re-exposed.
  secretHash?: string;
  // Optional idempotency window (ms) for dedup (Fase 1, mejora A1). Default 24h.
  idempotencyTtlMs?: number;
}

// Identifier for the AI provider that backs an `agent` node.
// Credentials are NOT stored in the platform; opencode reads them from the
// runner's environment (OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY,
// OLLAMA_HOST, ...) which is inherited via `...process.env`.
export type ProviderId = 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';

// Configurable catalog of known model IDs per provider. Used by the frontend
// to offer a filtered model dropdown per provider. Treat this as a curated,
// user-editable list rather than an exhaustive enumeration.
export const PROVIDER_MODELS: Record<ProviderId, string[]> = {
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'o3',
    'o4-mini'
  ],
  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-3-7-sonnet-latest',
    'claude-3-5-haiku-latest'
  ],
  google: [
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash'
  ],
  ollama: [
    'llama3.1',
    'llama3.2',
    'mistral',
    'qwen2.5',
    'codellama'
  ],
  custom: []
};

// Documented (optional) config shape for an `agent` node. `WorkflowStep.config`
// remains `Record<string, any>` for backward compatibility; this type documents
// the intended fields. `provider` is used as metadata/label by default; opencode
// still authenticates via machine env vars, not stored platform keys.
export interface AgentStepConfig {
  prompt: string;
  provider?: ProviderId;
  model?: string;
  agent?: string;
  projectId?: string;
  temperature?: number;
  maxTokens?: number;
}

export type StepType = 
  | 'trigger' 
  | 'normalizer' 
  | 'agent' 
  | 'condition' 
  | 'shell_test' 
  | 'git' 
  | 'pr' 
  | 'transform' 
  | 'output' 
  | 'approval'
  | 'nosql'
  | 'http_request'
  | 'code'
  | 'discord_notify'
  | 'google_sheets'
  | 'python'
  | 'json_parser'
  // Fase 3 — control-flow nodes
  | 'parallel'
  | 'loop'
  | 'retry'
  | 'wait';

export interface WorkflowStep {
  id: string;
  type: StepType;
  config: Record<string, any>;
  nextStepIds: string[]; // Directed edge pointers
}

// Optional typed shape for node payloads. WorkflowStep.config remains open-ended
// so persisted workflows created by older versions remain valid.
export interface NodeData {
  input?: unknown;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NodeExecutionResult {
  success: boolean;
  result?: unknown;
  data?: unknown;
  rows?: Array<Record<string, unknown> | unknown[]>;
  stdout?: string;
  stderr?: string;
  error?: string;
  [key: string]: unknown;
}

export interface RetentionPolicy {
  maxAgeDays?: number;
  maxItems?: number;
  retainArtifacts?: boolean;
}

export interface Workflow {
  id: string;
  name: string;
  projectId?: string;
  version: number;
  isActive: boolean;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export type ExecutionStatus = 'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'cancelled';

export interface ExecutionLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface ApprovalRequest {
  approvalId: string;
  actionType: string;
  command?: string;
  description: string;
}

// Fase v2 — Métricas por sesión de agente (parseadas del stdout de `opencode run`).
export interface AgentMetrics {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
}

export interface ExecutionSnapshot {
  stepOutputs: Record<string, any>;
  currentBranch?: string;
  artifacts: string[];
  variables: Record<string, any>;
}

export interface Execution {
  id: string; // Unique execution UUID
  projectId?: string;
  workflowId: string;
  workflowVersion: number;
  triggerType: 'webhook' | 'cron' | 'manual';
  triggerPayload: Record<string, any>;
  status: ExecutionStatus;
  currentBranch?: string; // The branch created for this execution
  artifacts: string[]; // Absolute paths or URLs of generated output assets
  logs: ExecutionLog[];
  pendingApprovals: ApprovalRequest[];
  stepOutputs?: Record<string, any>;
  variables?: Record<string, any>;
  errorMessage?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  pausedStepId?: string;
  debugSnapshots?: Record<string, ExecutionSnapshot>;
  // Idempotency key (Fase 1, mejora A1): set for webhook-triggered executions to
  // prevent duplicate executions from redelivered/retried webhooks.
  idempotencyKey?: string;
  // Optimistic concurrency version (Fase 1, mejora A7): incremented on each write.
  version?: number;
  // Audit trail of status transitions (Fase 1, mejora A3).
  statusHistory?: {
    status: ExecutionStatus;
    cause?: string;
    actor?: 'system' | 'agent' | 'user';
    at: string;
  }[];
  // Per-step timing/metrics (Fase 4, mejora E1).
  stepTimings?: {
    stepId: string;
    type: StepType;
    startedAt: string;
    durationMs: number;
    outcome: 'success' | 'failed' | 'skipped';
  }[];
  // Fase v2 — Métricas de agente por paso (key = stepId de pasos `agent`).
  agentMetrics?: Record<string, AgentMetrics>;
}

// Structured per-step event emitted for the live timeline (Fase 4, mejora E3).
// Sent over the SSE logs stream as `event: step` in addition to `log`/`status`.
export interface StepEvent {
  executionId: string;
  stepId: string;
  type: StepType;
  status: 'started' | 'finished' | 'failed' | 'waiting_approval';
  at: string;
}

export interface CronSchedule {
  id: string;
  name: string;
  projectId?: string;
  workflowId: string;
  cronExpression: string; // Standard 5-field cron: "* * * * *"
  timezone: string; // Local timezone (e.g. 'America/Bogota')
  isActive: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  // Re-trigger missed cron runs after downtime (Fase 6). When true, the
  // scheduler performs catch-up on startup/reload for runs missed while the
  // process was offline.
  missedCatchup?: boolean;
}

// Persisted queue entry for the durable queue (Fase 6). Only a marker of
// "pending" — the run callback is never persisted (it is not serializable).
export interface QueueEntry {
  id: string; // executionId
  projectId: string;
  enqueuedAt: string;
}

export interface EncryptedSecret {
  id: string; // key prefix, e.g. 'github_token', 'firebase_key'
  projectId: string;
  encryptedValue: string; // AES-256-GCM encrypted value
  iv: string; // Initialization vector
  tag: string; // Auth tag
  updatedAt: string;
}

// Interfaces for Portability Layer

export interface IStateStore {
  initialize(): Promise<void>;
  get<T>(collection: string, docId: string): Promise<T | null>;
  set<T>(collection: string, docId: string, data: T): Promise<void>;
  update<T>(collection: string, docId: string, data: Partial<T>): Promise<void>;
  delete(collection: string, docId: string): Promise<void>;
  list<T>(collection: string, filter?: (item: T) => boolean): Promise<T[]>;
  // Optional optimistic concurrency compare-and-swap (Fase 1, mejora A7).
  // Returns true only if the stored document still has `expectedVersion`; on success
  // the document is replaced with `data` (whose version should be expectedVersion + 1).
  compareAndSwap?<T>(collection: string, docId: string, expectedVersion: number, data: T): Promise<boolean>;
}

export interface IOpenCodeRunner {
  run(params: {
    message: string;
    model?: string;
    agent?: string;
    workdir: string;
    onLog: (log: string) => void;
  }): Promise<{ success: boolean; output: string; exitCode: number; metrics?: AgentMetrics }>;
}

export interface IGitProvider {
  cloneOrFetch(localPath: string, remoteUrl: string): Promise<void>;
  createBranch(localPath: string, branchName: string): Promise<void>;
  commitChanges(localPath: string, message: string): Promise<void>;
  push(localPath: string, branchName: string, githubToken: string): Promise<void>;
  createPullRequest(params: {
    localPath: string;
    title: string;
    body: string;
    headBranch: string;
    baseBranch: string;
    githubToken: string;
  }): Promise<{ prUrl: string; prNumber: number }>;
}

export interface ISecretStore {
  getSecret(projectId: string, key: string): Promise<string | null>;
  setSecret(projectId: string, key: string, value: string): Promise<void>;
  deleteSecret(projectId: string, key: string): Promise<void>;
}

export type WebhookFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface WebhookSchemaField {
  name: string;
  type: WebhookFieldType;
  description?: string;
  required?: boolean;
}

export interface WebhookSchema {
  fields: WebhookSchemaField[];
}

// Recursive schema node describing the expected shape of a webhook trigger
// payload. Mirrors a JSON Schema subset and is used by the WebhookSchemaEditor
// to let users define/validate incoming payloads.
export type SchemaNodeType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface SchemaNode {
  key: string;
  type: SchemaNodeType;
  description?: string;
  required: boolean;
  children?: SchemaNode[];
  itemsType?: SchemaNodeType;
}

// Config shape for a webhook trigger step. Stored under `WorkflowStep.config`
// when `triggerType === 'webhook'`.
export interface WebhookTriggerConfig {
  triggerType: 'webhook';
  payloadSchema?: SchemaNode[];
  regenerateToken?: boolean;
  [key: string]: any;
}

export { validateWorkflow } from './workflow-validation.js';
export type {
  WorkflowDiagnostic,
  WorkflowDiagnosticSeverity,
  WorkflowValidationResult
} from './workflow-validation.js';
