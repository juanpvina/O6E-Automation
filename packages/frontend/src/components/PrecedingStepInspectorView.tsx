import React from 'react';
import { WorkflowStep } from '@opencode/shared';
import { MOCK_STEP_OUTPUTS } from '../lib/constants';
import { JsonNode } from './JsonNode';

export interface PrecedingStepInspectorViewProps {
  workflowSteps: WorkflowStep[];
  selectedStepId: string;
  onCopy: (text: string) => void;
}

// Preceding Step Outputs Subcomponent View — shows the mock output preview of
// the step that feeds into the currently selected step.
export const PrecedingStepInspectorView: React.FC<PrecedingStepInspectorViewProps> = ({ workflowSteps, selectedStepId, onCopy }) => {
  const precedingStep = workflowSteps.find(s => {
    if (s.type === 'condition') {
      return s.config?.onTrue === selectedStepId || s.config?.onFalse === selectedStepId;
    }
    return s.nextStepIds.includes(selectedStepId);
  });

  if (!precedingStep) {
    return (
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 text-center">
        <span className="text-xs text-slate-500 block font-sans">
          This is an entry step (no preceding steps lead into it). Connect a step to this one to reference its outputs here.
        </span>
      </div>
    );
  }

  const mockData = MOCK_STEP_OUTPUTS[precedingStep.type] || {};

  return (
    <div className="space-y-3 bg-slate-900/40 border border-slate-800 rounded-xl p-4 shadow-inner text-left">
      <div className="flex justify-between items-center border-b border-slate-800 pb-2">
        <div>
          <span className="text-[10px] text-slate-500 uppercase font-bold block font-sans">Input Data (From Preceding Node)</span>
          <span className="text-xs font-bold text-slate-200 font-mono">
            {precedingStep.id} <span className="text-[11px] text-slate-500 uppercase font-bold font-sans">({precedingStep.type})</span>
          </span>
        </div>
        <span className="text-[11px] bg-emerald-950/80 border border-emerald-500/30 px-2 py-0.5 rounded text-emerald-400 font-bold uppercase">
          Output Data Preview
        </span>
      </div>
      
      <div className="bg-slate-950/80 rounded-lg p-3 border border-slate-800 max-h-[250px] overflow-y-auto">
        <div className="font-mono text-xs text-slate-500 select-none">{'{'}</div>
        {Object.keys(mockData).map((key, index, arr) => (
          <JsonNode
            key={key}
            label={key}
            value={mockData[key]}
            path={key}
            stepId={precedingStep.id}
            isLast={index === arr.length - 1}
            onCopy={onCopy}
          />
        ))}
        <div className="font-mono text-xs text-slate-500 select-none">{'}'}</div>
      </div>
      
      <p className="text-[10px] text-slate-500 font-sans leading-normal">
        💡 Hover over any output property and click <strong className="text-slate-400">Copy Path</strong> to copy the expression. You can paste it directly in downstream configuration fields.
      </p>
    </div>
  );
};