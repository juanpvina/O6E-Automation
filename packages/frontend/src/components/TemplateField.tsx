import React, { useState, useRef } from 'react';
import { Check } from 'lucide-react';
import { WorkflowStep } from '@opencode/shared';
import { buildVariablesForStep, collectPrecedingSteps } from '../lib/helpers';

export interface TemplateFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
  rows?: number;
  workflowSteps: WorkflowStep[];
  selectedStepId: string;
}

// A textarea/input that shows an autocomplete popover when the user types `{{`.
export const TemplateField: React.FC<TemplateFieldProps> = ({
  label,
  value,
  onChange,
  placeholder,
  hint,
  mono = true,
  rows,
  workflowSteps,
  selectedStepId
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const fieldRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const openIdxRef = useRef(-1);

  const preceding = React.useMemo(
    () => collectPrecedingSteps(workflowSteps, selectedStepId),
    [workflowSteps, selectedStepId]
  );

  const variables = React.useMemo(() => {
    const list: string[] = [];
    preceding.forEach(step => {
      buildVariablesForStep(step).forEach(v => {
        if (!list.includes(v)) list.push(v);
      });
    });
    return list;
  }, [preceding]);

  const filtered = React.useMemo(() => {
    const openIdx = openIdxRef.current;
    if (openIdx < 0) return variables;
    const query = value.slice(openIdx + 2).toLowerCase();
    if (!query) return variables;
    return variables.filter(v => v.toLowerCase().includes(query));
  }, [variables, value]);

  const isOpen = open && filtered.length > 0;

  const syncOpen = (raw: string) => {
    const lastOpen = raw.lastIndexOf('{{');
    if (lastOpen < 0) {
      setOpen(false);
      openIdxRef.current = -1;
      return;
    }
    const after = raw.slice(lastOpen + 2);
    const hasClose = after.includes('}}');
    if (!hasClose) {
      openIdxRef.current = lastOpen;
      setOpen(true);
      setActiveIndex(0);
    } else {
      setOpen(false);
      openIdxRef.current = -1;
    }
  };

  const handleChange = (raw: string) => {
    onChange(raw);
    syncOpen(raw);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === '{') {
        // Let the following input event pick up the second brace.
        return;
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insert(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const insert = (variable: string) => {
    const el = fieldRef.current;
    const openIdx = openIdxRef.current;
    let cursor = el?.selectionStart ?? value.length;
    if (openIdx < 0) return;
    const before = value.slice(0, openIdx);
    const after = value.slice(cursor);
    const next = `${before}{{${variable}}}${after}`;
    onChange(next);
    setOpen(false);
    openIdxRef.current = -1;
    requestAnimationFrame(() => {
      const nextCursor = before.length + variable.length + 4;
      if (el) {
        el.focus();
        el.setSelectionRange(nextCursor, nextCursor);
      }
    });
  };

  const handleBlur = () => {
    setTimeout(() => setOpen(false), 120);
  };

  const selectVariable = (variable: string) => {
    insert(variable);
  };

  const commonInputClass = `w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 ${
    mono ? 'font-mono' : ''
  }`;

  return (
    <div className="relative">
      {label && <label className="block text-xs font-semibold text-slate-400 mb-1.5">{label}</label>}
      {rows ? (
        <textarea
          ref={fieldRef as React.RefObject<HTMLTextAreaElement>}
          rows={rows}
          placeholder={placeholder}
          value={value}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={commonInputClass}
        />
      ) : (
        <input
          ref={fieldRef as React.RefObject<HTMLInputElement>}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={commonInputClass}
        />
      )}
      {hint && <span className="text-[10px] text-slate-500 block mt-1">{hint}</span>}

      {isOpen && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-slate-900 border border-slate-800 rounded-lg shadow-xl overflow-hidden">
          <div className="px-2.5 py-1.5 text-[9px] uppercase tracking-wider text-slate-500 font-bold bg-slate-950/60 border-b border-slate-800">
            Context Variables
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.slice(0, 40).map((variable, index) => (
              <button
                key={variable}
                type="button"
                onMouseDown={e => {
                  e.preventDefault();
                  selectVariable(variable);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`w-full text-left px-2.5 py-1.5 text-xs font-mono text-slate-200 transition flex items-center justify-between gap-2 ${
                  index === activeIndex ? 'bg-emerald-500/10 text-emerald-300' : ''
                }`}
              >
                <span className="truncate">{`{{${variable}}}`}</span>
                {index === activeIndex && <Check className="h-3 w-3 shrink-0 text-emerald-400" />}
              </button>
            ))}
          </div>
          <div className="px-2.5 py-1 text-[9px] text-slate-500 bg-slate-950/60 border-t border-slate-800">
            ↑↓ navigate · Enter/Tab insert · Esc dismiss
          </div>
        </div>
      )}
    </div>
  );
};