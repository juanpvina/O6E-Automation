import React from 'react';
import { AlertTriangle, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'waiting_approval';

const STATUS_CONFIG: Record<StepStatus, { label: string; className: string; icon: React.ReactNode }> = {
  succeeded: {
    label: 'Completado',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
  },
  failed: {
    label: 'Fallido',
    className: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    icon: <XCircle className="h-3.5 w-3.5 shrink-0" />
  },
  waiting_approval: {
    label: 'En espera',
    className: 'bg-purple-500/15 text-purple-400 border-purple-500/30 animate-pulse',
    icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
  },
  running: {
    label: 'En curso',
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    icon: <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
  },
  pending: {
    label: 'Pendiente',
    className: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
    icon: <Circle className="h-3.5 w-3.5 shrink-0" />
  }
};

// Reusable status badge for execution steps: icon + color-coded label.
// Use it in the step tracker and the step detail panel.
export const StatusBadge: React.FC<{ status: StepStatus }> = ({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span
      role="status"
      aria-label={`Estado: ${cfg.label}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${cfg.className}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
};
