# OpenCode Agent & Trigger Orchestrator - Detailed Design Specification

**Document Date:** 2026-08-20  
**Status:** Design Proposal  
**Authors:** Antigravity (AI Architect)

---

## 1. System Overview

This specification details the architecture and implementation design of a local-first platform to register projects, connections, and workflows of agentic tasks. The orchestrator triggers agent workflows on local repositories/folders and tracks execution history. It enables agents to diagnose errors, modify code, run tests, and open Pull Requests on GitHub without automatic merging.

### Key Technology Choices

- **Language:** TypeScript for both backend and frontend.
- **Repository Pattern:** Monorepo using npm workspaces.
- **Backend:** Node.js (Express or Fastify) + TypeScript + Node-Cron.
- **Frontend:** React + Vite + Tailwind CSS + Lucide Icons + shadcn/ui.
- **Persistence (Local StateStore):** A document-based StateStore implementing a Firestore-like NoSQL API, utilizing `lowdb` or a custom local JSON-file storage backend. This abstraction allows swapping the persistence layer with actual Firebase Firestore in the future without modifying the domain code.
- **Agent Runner:** OpenCode CLI interface (`opencode run` invoked via `child_process.spawn`) to execute agent steps locally. La configuración interactiva por proyecto se documenta como una capacidad separada en `2026-08-22-opencode-configured-terminal-v1-design.md`.

---

## 2. Directory Structure

```text
G:\WebService\Opencode2o\
├── package.json                   # Root package.json configuring npm workspaces
├── tsconfig.json                  # Root TypeScript configuration
├── docs/
│   ├── arquitectura-agentes-triggers.md
│   └── superpowers/
│       └── specs/
│           └── 2026-08-20-opencode-orchestrator-design.md  # This document
├── packages/
│   ├── shared/                    # Common interfaces, utility functions, schemas
│   │   ├── package.json
│   │   └── src/
│   │       ├── types.ts           # Shared TypeScript interfaces
│   │       └── validation.ts      # Input schema validations
│   ├── backend/                   # Orchestrator backend (API, worker, scheduler)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts           # Entry point
│   │       ├── services/
│   │       │   ├── store.ts       # StateStore implementation
│   │       │   ├── runner.ts      # OpenCode CLI wrapper
│   │       │   ├── queue.ts       # In-memory execution queue (per-project locks)
│   │       │   ├── scheduler.ts   # Cron scheduler
│   │       │   ├── git.ts         # Git provider (GitHub adapter using 'gh' CLI / simple git commands)
│   │       │   └── secrets.ts     # Simple local secret store manager
│   │       ├── routes/            # Webhooks, projects, workflows, approvals, executions API routes
│   │       └── server.ts          # API Server configuration
│   └── frontend/                  # React dashboard and visual builder
│       ├── package.json
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── components/        # Layout, charts, workflow designer, logs viewer
│           └── hooks/             # Custom hooks for fetching and SSE events
```

---

## 3. Domain Model and Document Schemas

All storage models represent NoSQL collections. The `StateStore` implements methods to query and update these records.

### 3.1 Projects (`projects` collection)
Represents a local folder associated with a remote git repository.
```typescript
interface Project {
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
```

### 3.2 Connections (`connections` collection)
Links incoming external triggers (e.g., error alert webhooks) to a project and a specific workflow.
```typescript
interface Connection {
  id: string; // Unique public slug or ID
  name: string;
  projectId: string;
  workflowId: string;
  tokenHash: string; // Salted hash of the Bearer token used for verification
  createdAt: string;
  updatedAt: string;
}
```

### 3.3 Workflows (`workflows` collection)
Defines a directed graph of steps that the orchestrator executes.
```typescript
interface WorkflowStep {
  id: string;
  type: 'trigger' | 'normalizer' | 'agent' | 'condition' | 'shell_test' | 'git' | 'pr' | 'transform' | 'output' | 'approval';
  config: Record<string, any>;
  nextStepIds: string[]; // Directed edge pointers
}

interface Workflow {
  id: string;
  name: string;
  projectId: string;
  version: number;
  isActive: boolean;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}
```

### 3.4 Executions (`executions` collection)
Tracks every execution run of a workflow.
```typescript
type ExecutionStatus = 'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'cancelled';

interface ExecutionLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

interface Execution {
  id: string; // Unique execution UUID
  projectId: string;
  workflowId: string;
  workflowVersion: number;
  triggerType: 'webhook' | 'cron' | 'manual';
  triggerPayload: Record<string, any>;
  status: ExecutionStatus;
  currentBranch?: string; // The branch created for this execution
  artifacts: string[]; // Absolute paths or URLs of generated output assets
  logs: ExecutionLog[];
  pendingApprovals: {
    approvalId: string;
    actionType: string;
    command?: string;
    description: string;
  }[];
  errorMessage?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

### 3.5 Cron Schedules (`schedules` collection)
Cron jobs that trigger workflows on a timer.
```typescript
interface CronSchedule {
  id: string;
  name: string;
  projectId: string;
  workflowId: string;
  cronExpression: string; // Standard 5-field cron: "* * * * *"
  timezone: string; // Local timezone (e.g. 'America/Bogota')
  isActive: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}
```

### 3.6 Secrets (`secrets` collection)
Secure storage for external API tokens (GitHub, Firebase, Webhooks). Kept separately and NEVER displayed in UI or API responses.
```typescript
interface EncryptedSecret {
  id: string; // key prefix, e.g. 'github_token', 'firebase_key'
  projectId: string;
  encryptedValue: string; // AES-256-GCM encrypted value
  iv: string; // Initialization vector
  tag: string; // Auth tag
  updatedAt: string;
}
```

---

## 4. Portability Interfaces

To ensure porting from localhost to VPS or Cloud Run is seamless, the core business logic will interact with database and provider layers strictly through interfaces.

### 4.1 StateStore
Abstracts the document database.
```typescript
export interface IStateStore {
  initialize(): Promise<void>;
  get<T>(collection: string, docId: string): Promise<T | null>;
  set<T>(collection: string, docId: string, data: T): Promise<void>;
  update<T>(collection: string, docId: string, data: Partial<T>): Promise<void>;
  delete(collection: string, docId: string): Promise<void>;
  list<T>(collection: string, filter?: (item: T) => boolean): Promise<T[]>;
}
```

### 4.2 OpenCodeRunner
Abstracts non-interactive execution of the agent. No representa la terminal usada por el operador para configurar OpenCode.
```typescript
export interface IOpenCodeRunner {
  run(params: {
    message: string;
    model?: string;
    agent?: string;
    workdir: string;
    onLog: (log: string) => void;
  }): Promise<{ success: boolean; output: string; exitCode: number }>;
}
```

### 4.3 GitProvider
Abstracts repository operations.
```typescript
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
```

### 4.4 SecretStore
Abstracts encryption/decryption of local project credentials.
```typescript
export interface ISecretStore {
  getSecret(projectId: string, key: string): Promise<string | null>;
  setSecret(projectId: string, key: string, value: string): Promise<void>;
  deleteSecret(projectId: string, key: string): Promise<void>;
}
```

---

## 5. System Components & Flow

### 5.1 Concurrency Lock & Project Queue
Since we only allow one execution active per project, the orchestrator maintains an in-memory queue manager.

```typescript
class ProjectQueueManager {
  private activeExecutions = new Map<string, string>(); // projectId -> executionId
  private queues = new Map<string, string[]>(); // projectId -> executionIds[]

  async enqueue(projectId: string, executionId: string, runCallback: () => Promise<void>) {
    if (!this.queues.has(projectId)) {
      this.queues.set(projectId, []);
    }
    this.queues.get(projectId)!.push(executionId);
    
    this.processQueue(projectId, runCallback);
  }

  private async processQueue(projectId: string, runCallback: () => Promise<void>) {
    if (this.activeExecutions.has(projectId)) {
      // Busy processing another execution for this project
      return;
    }

    const queue = this.queues.get(projectId) || [];
    if (queue.length === 0) return;

    const nextExecutionId = queue.shift()!;
    this.activeExecutions.set(projectId, nextExecutionId);

    try {
      await runCallback();
    } finally {
      this.activeExecutions.delete(projectId);
      // Recurse to process the next item in queue
      this.processQueue(projectId, runCallback);
    }
  }
}
```

### 5.2 The Worker Execution Flow
When a workflow execution starts running:
1. **Initialize Context:** Create execution record in `StateStore`, update status to `running`.
2. **Setup Workdir:**
   - Git Provider checks out the `baseBranch`.
   - Ensures no dirty files exist (clean state).
3. **Execute Steps Sequentially:**
   - **Trigger / Normalizer:** Parse incoming payload and build input context.
    - **Agent:** Invoke `OpenCodeRunner.run` with agent type, prompt message, and model config. Capture output logs in real-time and stream them to the execution logs database. Cada invocación inicia una sesión nueva; no se persiste ni reutiliza un `sessionId` conversacional.
   - **Condition:** Simple evaluation script (JSON/JS) checking previous step results.
   - **Shell / Test:** Runs pre-authorized commands (e.g. `npm run test`).
     - If the command fails, mark execution as `failed` (or handle according to policy).
     - If a command is not pre-authorized, transition execution to `waiting_approval` and create an approval request.
   - **Approval Node:** Pauses the execution, sets status to `waiting_approval`. A user must trigger the `/approvals/:id/approve` endpoint to resume or cancel it.
   - **Git / PR Node:**
     - Generate branch name: `opencode/exec-${executionId}`.
     - Checkout new branch, stage modifications, commit them with a descriptive message generated by the agent.
     - Push branch to origin.
     - Call Git Provider to open a Pull Request. **No automatic merging is ever allowed.**
   - **Output Node:**
     - Write artifact reports locally.
     - Publish payload or report to external webhook / Firestore using the OutputAdapter configuration.
4. **Finalize Context:** Set status to `succeeded` (or `failed` if any step crashed). Write completed date.

---

## 6. Security and Safety Rules

- **Path Isolation:** The runner checks that the `localPath` of the project is a absolute folder and verifies that no commands (such as shell commands, read/write/edit operations) can access paths above the project root. For instance, any file edit operation checks:
  ```typescript
  if (!filePath.startsWith(project.localPath)) {
    throw new Error("Access denied: File path lies outside project directory.");
  }
  ```
- **Secrets Redaction in Logs:** Any stdout/stderr logs from OpenCode or shell processes are filtered using regex patterns mapping back to secrets registered in the `secrets` store:
  ```typescript
  function redactSecrets(text: string, secrets: string[]): string {
    let sanitized = text;
    for (const secret of secrets) {
      if (secret.length > 5) {
        sanitized = sanitized.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
      }
    }
    return sanitized;
  }
  ```
- **Safe CLI Command Execution:** Shell command executions are passed through structured arrays (`spawn` args) instead of plain concatenated string commands, avoiding shell-injection vulnerabilities.

---

## 7. Verification and Testing

1. **Unit Tests:** Write tests for the `ProjectQueueManager` to verify serial execution and ensure concurrent runs on the same project are correctly queued.
2. **Integration Tests:** Mock the `IOpenCodeRunner` to simulate successful agent fixes and failure scenarios (such as failing tests).
3. **Trigger Validation Tests:** Test the Bearer validation of the webhook route with invalid tokens, expired signatures, and replay tokens.

---

## 8. Next Steps (Implementation Plan)

1. Scaffold the monorepo structure.
2. Write shared models and types in `packages/shared`.
3. Implement `packages/backend` including:
   - File-based `StateStore` (using `lowdb`).
   - Webhook & API endpoints (Express/TypeScript).
   - In-memory `ProjectQueueManager`.
   - OpenCode run CLI wrapper.
4. Implement `packages/frontend` utilizing Vite, React, Tailwind, and Vite API proxy configuration.
5. Create a basic end-to-end integration test workflow.
