import {
  Execution,
  SchemaNode,
  SchemaNodeType,
  StepEvent,
  Workflow,
  WorkflowStep
} from '@opencode/shared';
import {
  HANG_THRESHOLD_MS,
  MOCK_STEP_OUTPUTS,
  STEP_TYPE_FALLBACK_NAMES
} from './constants';

// ==========================================
// 1.5. Cron Validation and Parsing Helpers
// ==========================================
export const parseCronToSimple = (expression: string) => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { frequency: 'daily', hour: '9', minute: '0', daysOfWeek: [1,2,3,4,5], dayOfMonth: '1' };
  }
  const [min, hr, dom, , dow] = parts;

  let frequency = 'daily';
  let hour = hr === '*' ? '9' : hr;
  let minute = min === '*' ? '0' : min;
  let daysOfWeek = [1,2,3,4,5];
  let dayOfMonth = '1';

  if (dow !== '*') {
    frequency = 'weekly';
    const days = new Set<number>();
    dow.split(',').forEach(part => {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = start; i <= end; i++) days.add(i % 7);
        }
      } else {
        const val = Number(part);
        if (!isNaN(val)) days.add(val % 7);
      }
    });
    daysOfWeek = days.size > 0 ? Array.from(days).sort() : [1,2,3,4,5];
  } else if (dom !== '*') {
    frequency = 'monthly';
    dayOfMonth = dom;
  }

  return { frequency, hour, minute, daysOfWeek, dayOfMonth };
};

export const validateCronExpression = (expr: string): { isValid: boolean; error?: string } => {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { isValid: false, error: 'Must have exactly 5 space-separated fields.' };
  }
  const [min, hr, dom, month, dow] = parts;

  const checkField = (field: string, minVal: number, maxVal: number): boolean => {
    if (field === '*') return true;
    const subparts = field.split(',');
    for (const sub of subparts) {
      if (sub === '*') continue;
      const rangeStep = sub.split('/');
      const range = rangeStep[0];
      const step = rangeStep[1];
      if (step !== undefined) {
        const stepNum = Number(step);
        if (isNaN(stepNum) || stepNum <= 0) return false;
      }
      if (range !== '*') {
        const limits = range.split('-');
        if (limits.length === 1) {
          const val = Number(limits[0]);
          if (isNaN(val) || val < minVal || val > maxVal) return false;
        } else if (limits.length === 2) {
          const start = Number(limits[0]);
          const end = Number(limits[1]);
          if (isNaN(start) || isNaN(end) || start < minVal || start > maxVal || end < minVal || end > maxVal || start > end) return false;
        } else {
          return false;
        }
      }
    }
    return true;
  };

  if (!checkField(min, 0, 59)) return { isValid: false, error: 'Invalid minute field (0-59).' };
  if (!checkField(hr, 0, 23)) return { isValid: false, error: 'Invalid hour field (0-23).' };
  if (!checkField(dom, 1, 31)) return { isValid: false, error: 'Invalid day of month field (1-31).' };
  if (!checkField(month, 1, 12)) return { isValid: false, error: 'Invalid month field (1-12).' };
  if (!checkField(dow, 0, 7)) return { isValid: false, error: 'Invalid day of week field (0-7).' };

  return { isValid: true };
};

// ==========================================
// 1.6. Frontend template interpolation
// ==========================================
// Resolves `{{triggerPayload.KEY}}`, `{{context.triggerPayload.KEY}}`,
// `{{stepOutputs.STEPID.KEY}}` and `{{context.stepOutputs.STEPID.KEY}}`
// against an execution's triggerPayload / stepOutputs. Unresolvable
// variables are left untouched (never crashes).
export const interpolateFrontend = (template: string, payload?: Record<string, any>, stepOutputs?: Record<string, any>): string => {
  if (!template) return template;

  const resolvePath = (obj: any, path: string): any => {
    return path.split('.').reduce((acc, key) => {
      if (acc == null) return undefined;
      return acc[key];
    }, obj);
  };

  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, expr) => {
    const path = expr.trim();

    // triggerPayload.KEY or context.triggerPayload.KEY
    let m = path.match(/^(?:context\.)?triggerPayload\.(.+)$/);
    if (m && payload) {
      const val = resolvePath(payload, m[1]);
      if (val !== undefined && val !== null) {
        return typeof val === 'object' ? JSON.stringify(val) : String(val);
      }
      return match;
    }

    // stepOutputs.STEPID.KEY or context.stepOutputs.STEPID.KEY
    m = path.match(/^(?:context\.)?stepOutputs\.(.+)$/);
    if (m && stepOutputs) {
      const val = resolvePath(stepOutputs, m[1]);
      if (val !== undefined && val !== null) {
        return typeof val === 'object' ? JSON.stringify(val) : String(val);
      }
      return match;
    }

    return match;
  });
};

// ==========================================
// 1.7. Friendly status labels & duration helpers
// ==========================================
export const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'queued': return 'En cola';
    case 'running': return 'Ejecutando';
    case 'waiting_approval': return 'En espera de aprobación';
    case 'succeeded': return 'Completado';
    case 'failed': return 'Fallido';
    case 'cancelled': return 'Cancelado';
    default: return status || 'Desconocido';
  }
};

export const formatDuration = (ms: number): string => {
  if (!isFinite(ms) || ms < 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

export const getRunDurationLabel = (execution: Execution, now: number): string => {
  const start = execution.startedAt || execution.queuedAt;
  const startMs = start ? new Date(start).getTime() : now;
  if (execution.completedAt) {
    const endMs = new Date(execution.completedAt).getTime();
    return formatDuration(endMs - startMs);
  }
  if (execution.status === 'running' || execution.status === 'waiting_approval' || execution.status === 'queued') {
    return `en curso... (${formatDuration(now - startMs)})`;
  }
  return formatDuration(now - startMs);
};

export const isHangingExecution = (execution: Execution, now: number): boolean => {
  if (!(execution.status === 'running' || execution.status === 'waiting_approval' || execution.status === 'queued')) {
    return false;
  }
  if (execution.completedAt) return false;
  const start = execution.startedAt || execution.queuedAt;
  if (!start) return false;
  return now - new Date(start).getTime() > HANG_THRESHOLD_MS;
};

export const getStepDisplayName = (step: WorkflowStep): string => {
  if (step.config?.name && String(step.config.name).trim()) {
    return String(step.config.name).trim();
  }
  return STEP_TYPE_FALLBACK_NAMES[step.type] || step.id;
};

// Handle status colors (badge classes for execution / step statuses).
export const getStatusColor = (status: string) => {
  switch (status) {
    case 'queued': return 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30';
    case 'running': return 'bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse';
    case 'waiting_approval': return 'bg-purple-500/20 text-purple-400 border border-purple-500/30 animate-pulse';
    case 'succeeded': return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    case 'failed': return 'bg-rose-500/20 text-rose-400 border border-rose-500/30';
    case 'cancelled': return 'bg-slate-500/20 text-slate-400 border border-slate-500/30';
    default: return 'bg-slate-500/20 text-slate-400';
  }
};

// ==========================================
// 1.8. Per-step detail helpers (Fase 5)
// ==========================================
// Window (start..end) of a step based on its timing record, if available.
export const getStepTimeWindow = (
  stepId: string,
  stepTimings?: Execution['stepTimings']
): { startMs: number; endMs: number } | null => {
  const timing = stepTimings?.find(t => t.stepId === stepId);
  if (!timing?.startedAt) return null;
  const startMs = new Date(timing.startedAt).getTime();
  let endMs = startMs + (timing.durationMs ?? 0);
  if (!timing.outcome || timing.durationMs === 0) {
    endMs = Date.now();
  }
  // Buffer of 1s before start and 2s after end to capture asynchronous logs
  return { startMs: startMs - 1000, endMs: endMs + 2000 };
};

// Filter the execution log stream down to the entries that belong to a step.
// Primary signal: timestamp falling inside the step's time window. Fallback:
// messages that name the step id.
export const getLogsForStep = (
  stepId: string,
  currentLogs: { timestamp: string; level: string; message: string }[],
  stepTimings?: Execution['stepTimings']
): { timestamp: string; level: string; message: string }[] => {
  const window = getStepTimeWindow(stepId, stepTimings);
  const needle = stepId.toLowerCase();
  
  return currentLogs.filter(l => {
    if (window) {
      const t = new Date(l.timestamp).getTime();
      if (t >= window.startMs && t <= window.endMs) {
        return true;
      }
    }
    return l.message.toLowerCase().includes(needle);
  });
};

// Determine the status of execution steps by scanning structured step events
// (preferred) or falling back to log-regex heuristics.
export const getStepStatuses = (workflow: Workflow, execution: Execution, currentLogs: { timestamp: string; level: string; message: string }[], currentStepEvents: StepEvent[] = []) => {
  const statuses: Record<string, 'pending' | 'running' | 'succeeded' | 'failed' | 'waiting_approval'> = {};

  // Default all steps to pending
  for (const step of workflow.steps) {
    statuses[step.id] = 'pending';
  }

  // Persisted timings are the source of truth when reopening a historical
  // execution. SSE step events only exist while the execution is live.
  for (const timing of execution.stepTimings || []) {
    if (!(timing.stepId in statuses)) continue;
    if (timing.outcome === 'success') statuses[timing.stepId] = 'succeeded';
    else if (timing.outcome === 'failed') statuses[timing.stepId] = 'failed';
    else statuses[timing.stepId] = 'running';
  }

  // Fase 4 — Prefer structured `step` events emitted over the SSE stream.
  // Falls back to the log-regex heuristic below when no events arrive.
  if (currentStepEvents.length > 0) {
    const ordered = [...currentStepEvents].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
    );
    for (const ev of ordered) {
      if (!(ev.stepId in statuses)) continue;
      if (ev.status === 'started') statuses[ev.stepId] = 'running';
      else if (ev.status === 'finished') statuses[ev.stepId] = 'succeeded';
      else if (ev.status === 'failed') statuses[ev.stepId] = 'failed';
      else if (ev.status === 'waiting_approval') statuses[ev.stepId] = 'waiting_approval';
    }
    // Safety net: a succeeded execution should never leave steps "running".
    if (execution.status === 'succeeded') {
      for (const step of workflow.steps) {
        if (statuses[step.id] === 'running') statuses[step.id] = 'succeeded';
      }
    }
    return statuses;
  }

  let lastStartedStepId: string | null = null;
  const startedSteps: string[] = [];

  for (const log of currentLogs) {
    const msg = log.message;

    const execMatch = msg.match(/Executing step "([^"]+)"/);
    if (execMatch) {
      const stepId = execMatch[1];
      statuses[stepId] = 'running';
      lastStartedStepId = stepId;
      startedSteps.push(stepId);
    }

    const finishMatch = msg.match(/Step "([^"]+)" finished\./);
    if (finishMatch) {
      const stepId = finishMatch[1];
      statuses[stepId] = 'succeeded';
    }

    const pauseMatch = msg.match(/Waiting for human approval on step "([^"]+)"/);
    if (pauseMatch) {
      const stepId = pauseMatch[1];
      statuses[stepId] = 'waiting_approval';
    }
  }

  // Log heuristics can be incomplete or arrive without the matching finish
  // line. Re-apply persisted outcomes so a completed node is not displayed as
  // pending just because the page was opened after the SSE event.
  for (const timing of execution.stepTimings || []) {
    if (!(timing.stepId in statuses)) continue;
    if (timing.outcome === 'success') statuses[timing.stepId] = 'succeeded';
    else if (timing.outcome === 'failed') statuses[timing.stepId] = 'failed';
  }

  if (execution.status === 'waiting_approval' && execution.pendingApprovals?.[0]?.approvalId) {
    statuses[execution.pendingApprovals[0].approvalId] = 'waiting_approval';
  }

  if (execution.status === 'succeeded') {
    for (const step of workflow.steps) {
      if (statuses[step.id] === 'running') {
        statuses[step.id] = 'succeeded';
      }
    }
  }

  // Robustly determine which step failed when the execution failed.
  if (execution.status === 'failed') {
    let failedStepId: string | null = null;

    // Preferred signal: stepOutputs. A step whose output reports success === false
    // (or that carries an error) is the one that failed.
    if (execution.stepOutputs && typeof execution.stepOutputs === 'object') {
      const outputIds = Object.keys(execution.stepOutputs);
      for (const stepId of outputIds) {
        const output = execution.stepOutputs[stepId];
        if (output && (output.success === false || output.error || output.errorMessage)) {
          failedStepId = stepId;
          break;
        }
      }
      // If no step output is explicitly failed but the execution failed, the last
      // executed step (furthest along in the workflow) is the culprit.
      if (!failedStepId && outputIds.length > 0) {
        const lastOutputId = outputIds[outputIds.length - 1];
        if (workflow.steps.some(s => s.id === lastOutputId)) {
          failedStepId = lastOutputId;
        }
      }
    }

    // Fallback heuristic: the failed step is the last step that started
    // ("Executing step ...") without a matching "finished." log.
    if (!failedStepId && lastStartedStepId) {
      for (let i = startedSteps.length - 1; i >= 0; i--) {
        if (statuses[startedSteps[i]] !== 'succeeded') {
          failedStepId = startedSteps[i];
          break;
        }
      }
      if (!failedStepId) failedStepId = lastStartedStepId;
    }

    if (failedStepId) {
      statuses[failedStepId] = 'failed';
    }
  }

  return statuses;
};

// ==========================================
// 3.5 Webhook Schema Inference Helper
// ==========================================
export const inferSchemaType = (value: any): SchemaNodeType => {
  if (value === null) return 'string';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'object') return 'object';
  return 'string';
};

export const inferSchemaFromJson = (obj: any): SchemaNode[] => {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.keys(obj).map(key => {
    const value = obj[key];
    const type = inferSchemaType(value);
    const node: SchemaNode = { key, type, required: true };
    if (type === 'object' && value !== null && typeof value === 'object') {
      node.children = inferSchemaFromJson(value);
    } else if (type === 'array' && Array.isArray(value)) {
      const itemType = value.length > 0 ? inferSchemaType(value[0]) : 'string';
      node.itemsType = itemType;
      const firstItem = value[0];
      if (itemType === 'object' && firstItem && typeof firstItem === 'object') {
        node.children = inferSchemaFromJson(firstItem);
      }
    }
    return node;
  });
};

// ==========================================
// 3.7 Context Variable Autocomplete
// ==========================================
// Backward graph traversal: gathers every step that can reach the selected step
// (following nextStepIds forward edges in reverse, plus condition branches).
export const collectPrecedingSteps = (steps: WorkflowStep[], targetId: string): WorkflowStep[] => {
  const visited = new Set<string>();
  const result: WorkflowStep[] = [];
  const queue: string[] = [targetId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const step of steps) {
      if (visited.has(step.id)) continue;
      const isConditionBranch = step.type === 'condition'
        && (step.config?.onTrue === current || step.config?.onFalse === current);
      const feedsCurrent = step.nextStepIds.includes(current);
      if (isConditionBranch || feedsCurrent) {
        visited.add(step.id);
        result.push(step);
        queue.push(step.id);
      }
    }
  }
  return result;
};

// Flatten an object of scalar/leaf keys into dotted paths.
export const collectLeafKeys = (data: Record<string, any>, prefix = ''): string[] => {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...collectLeafKeys(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
};

// Build the full set of `{{...}}` context variables available from one step's
// output (as seen by downstream steps). Trigger steps expose triggerPayload.
export const buildVariablesForStep = (step: WorkflowStep): string[] => {
  const vars: string[] = [];

  if (step.type === 'trigger' && step.config?.triggerType === 'webhook') {
    const base = 'context.triggerPayload';
    const payloadSchema: SchemaNode[] | undefined = step.config?.payloadSchema;
    if (payloadSchema && payloadSchema.length > 0) {
      const flatten = (nodes: SchemaNode[], prefix: string) => {
        nodes.forEach(n => {
          const path = prefix ? `${prefix}.${n.key}` : n.key;
          if (n.type === 'object' && n.children) {
            flatten(n.children, path);
          } else {
            vars.push(`{{${base}.${path}}}`);
          }
        });
      };
      flatten(payloadSchema, '');
    } else {
      // Fall back to a sample trigger payload for convenience.
      const sample = MOCK_STEP_OUTPUTS.trigger?.payload as Record<string, any> || {};
      collectLeafKeys(sample).forEach(path => vars.push(`{{${base}.${path}}}`));
    }
    return vars;
  }

  const base = `context.stepOutputs.${step.id}`;
  const mock = MOCK_STEP_OUTPUTS[step.type] || {};
  collectLeafKeys(mock).forEach(path => vars.push(`{{${base}.${path}}}`));
  return vars;
};
