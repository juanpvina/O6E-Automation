import { describe, expect, it } from 'vitest';
import { validateWorkflow } from '@opencode/shared';

const step = (id: string, type: any, nextStepIds: string[] = [], config: Record<string, any> = {}) => ({ id, type, nextStepIds, config });

describe('validateWorkflow', () => {
  it('reports duplicate IDs, missing references and a missing trigger', () => {
    const result = validateWorkflow({ steps: [step('same', 'agent', ['missing']), step('same', 'output')] });
    expect(result.errors.map(error => error.code)).toEqual(expect.arrayContaining(['duplicate-step-id', 'missing-step-reference', 'trigger-required']));
  });

  it('reports control-flow references and basic loop/retry configuration', () => {
    const result = validateWorkflow({ steps: [
      step('trigger', 'trigger'),
      step('condition', 'condition', [], { onTrue: 'missing', onFalse: '' }),
      step('loop', 'loop', [], {}),
      step('retry', 'retry', [], { retries: -1 })
    ] });
    expect(result.errors.map(error => error.code)).toEqual(expect.arrayContaining(['reference-required', 'missing-step-reference', 'loop-items-required', 'retry-count-invalid']));
  });

  it('only warns for unreachable steps', () => {
    const result = validateWorkflow({ steps: [step('trigger', 'trigger'), step('orphan', 'output')] });
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'unreachable-step', stepId: 'orphan' })]);
  });
});
