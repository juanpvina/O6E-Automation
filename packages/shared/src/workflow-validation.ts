import type { Workflow, WorkflowStep } from './types.js';

export type WorkflowDiagnosticSeverity = 'error' | 'warning';

export interface WorkflowDiagnostic {
  severity: WorkflowDiagnosticSeverity;
  code: string;
  message: string;
  stepId?: string;
}

export interface WorkflowValidationResult {
  errors: WorkflowDiagnostic[];
  warnings: WorkflowDiagnostic[];
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function validateWorkflow(workflow: Pick<Workflow, 'steps'>): WorkflowValidationResult {
  const errors: WorkflowDiagnostic[] = [];
  const warnings: WorkflowDiagnostic[] = [];
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  const byId = new Map<string, WorkflowStep>();

  for (const step of steps) {
    if (!isNonEmptyString(step.id)) {
      errors.push({ severity: 'error', code: 'step-id-required', message: 'Cada paso debe tener un ID.' });
      continue;
    }
    if (byId.has(step.id)) {
      errors.push({ severity: 'error', code: 'duplicate-step-id', message: `El ID de paso "${step.id}" está duplicado.`, stepId: step.id });
    } else {
      byId.set(step.id, step);
    }
  }

  const reference = (target: unknown, stepId: string, field: string, required = false) => {
    if (!isNonEmptyString(target)) {
      if (required) errors.push({ severity: 'error', code: 'reference-required', message: `El paso "${stepId}" requiere una referencia en ${field}.`, stepId });
      return;
    }
    if (!byId.has(target)) {
      errors.push({ severity: 'error', code: 'missing-step-reference', message: `El paso "${stepId}" referencia el paso inexistente "${target}" en ${field}.`, stepId });
    }
  };

  const triggers = steps.filter(step => step.type === 'trigger');
  if (triggers.length === 0) {
    errors.push({ severity: 'error', code: 'trigger-required', message: 'El workflow debe tener al menos un paso trigger.' });
  }

  for (const step of steps) {
    const nextStepIds = Array.isArray(step.nextStepIds) ? step.nextStepIds : [];
    for (const target of nextStepIds) reference(target, step.id, 'nextStepIds');

    const config = step.config || {};
    if (step.type === 'condition') {
      reference(config.onTrue, step.id, 'config.onTrue', true);
      reference(config.onFalse, step.id, 'config.onFalse', true);
    }
    if (step.type === 'parallel') {
      if (nextStepIds.length === 0) {
        errors.push({ severity: 'error', code: 'parallel-branches-required', message: `El paso paralelo "${step.id}" debe tener al menos una rama en nextStepIds.`, stepId: step.id });
      }
      if (config.branches !== undefined) {
        if (!Array.isArray(config.branches) || config.branches.length === 0) {
          errors.push({ severity: 'error', code: 'parallel-branches-invalid', message: `Las ramas configuradas del paso paralelo "${step.id}" deben ser un array no vacío.`, stepId: step.id });
        } else {
          config.branches.forEach((target: unknown) => reference(target, step.id, 'config.branches'));
        }
      }
      reference(config.joinNextStepId, step.id, 'config.joinNextStepId');
    }
    if (step.type === 'loop') {
      if (nextStepIds.length === 0) reference(undefined, step.id, 'nextStepIds[0]', true);
      reference(config.bodyStepId, step.id, 'config.bodyStepId');
      reference(config.joinNextStepId, step.id, 'config.joinNextStepId');
      if (!Array.isArray(config.items) && !isNonEmptyString(config.itemsExpr)) {
        errors.push({ severity: 'error', code: 'loop-items-required', message: `El loop "${step.id}" debe definir items o itemsExpr.`, stepId: step.id });
      }
    }
    if (step.type === 'retry') {
      if (nextStepIds.length === 0) reference(undefined, step.id, 'nextStepIds[0]', true);
      reference(config.stepId, step.id, 'config.stepId');
      reference(config.onFailure, step.id, 'config.onFailure');
      if (config.retries !== undefined && (!Number.isInteger(config.retries) || config.retries < 0)) {
        errors.push({ severity: 'error', code: 'retry-count-invalid', message: `El número de reintentos del paso "${step.id}" debe ser un entero mayor o igual a cero.`, stepId: step.id });
      }
      if (config.retryDelayMs !== undefined && (!Number.isFinite(config.retryDelayMs) || config.retryDelayMs < 0)) {
        errors.push({ severity: 'error', code: 'retry-delay-invalid', message: `El retraso de reintento del paso "${step.id}" debe ser un número mayor o igual a cero.`, stepId: step.id });
      }
    }
  }

  if (triggers.length > 0) {
    const reachable = new Set<string>();
    const visit = (stepId: string) => {
      if (reachable.has(stepId)) return;
      const step = byId.get(stepId);
      if (!step) return;
      reachable.add(stepId);
      const targets = [...(step.nextStepIds || [])];
      if (step.type === 'condition') targets.push(step.config?.onTrue, step.config?.onFalse);
      if (step.config?.joinNextStepId) targets.push(step.config.joinNextStepId);
      for (const target of targets) if (isNonEmptyString(target)) visit(target);
    };
    triggers.forEach(trigger => visit(trigger.id));
    for (const step of steps) {
      if (!reachable.has(step.id)) {
        warnings.push({ severity: 'warning', code: 'unreachable-step', message: `El paso "${step.id}" no es alcanzable desde ningún trigger.`, stepId: step.id });
      }
    }
  }

  return { errors, warnings };
}
