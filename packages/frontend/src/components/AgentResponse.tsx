import React from 'react';
import { Bot, Clock, Coins, Cpu, Hash } from 'lucide-react';
import { AgentMetrics, WorkflowStep } from '@opencode/shared';
import { ReadonlyJson } from './ReadonlyJson';
import { LogEntry } from '../hooks/useExecutionStream';
import { formatDuration, getStepDisplayName } from '../lib/helpers';

interface AgentResponseProps {
  step: WorkflowStep;
  output: any;
  metrics?: AgentMetrics;
  logs: LogEntry[];
}

// Try to surface a plain-text answer out of a step's output, whatever shape it
// has (raw string, `{ response }`, `{ output }`, `{ result }`, etc.).
function extractResponseText(output: any): string | null {
  if (output == null) return null;
  if (typeof output === 'string') return output.trim() ? output : null;
  if (typeof output === 'object' && !Array.isArray(output)) {
    for (const key of ['response', 'output', 'result', 'answer', 'text', 'content', 'message']) {
      const value = output[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return null;
}

const formatCost = (usd: number): string => {
  const fixed = usd.toFixed(4).replace(/\.?0+$/, '');
  return `$${fixed}`;
};

// Readable panel with the full agent session response plus its metrics
// (model, tokens, estimated cost, duration) — instead of raw, unreadable JSON.
export const AgentResponse: React.FC<AgentResponseProps> = ({ step, output, metrics, logs }) => {
  const inlineMetrics =
    output && typeof output === 'object' && !Array.isArray(output) && output.metrics &&
    typeof output.metrics === 'object'
      ? (output.metrics as AgentMetrics)
      : undefined;

  const merged: AgentMetrics = metrics ?? inlineMetrics ?? {};

  const responseText = extractResponseText(output);
  const hasStructured = output !== undefined && (typeof output === 'object' || Array.isArray(output));

  const showText = responseText !== null;
  const showStructured = hasStructured && responseText === null;

  const hasMetrics = Boolean(
    merged.model ||
    merged.inputTokens != null ||
    merged.outputTokens != null ||
    merged.totalTokens != null ||
    merged.estimatedCostUsd != null ||
    merged.durationMs != null
  );

  const totalTokens = merged.totalTokens ?? (
    merged.inputTokens != null || merged.outputTokens != null
      ? (merged.inputTokens ?? 0) + (merged.outputTokens ?? 0)
      : undefined
  );

  return (
    <div className="space-y-3">
      {/* Response / output of the agent session */}
      <div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5 font-sans flex items-center gap-1.5">
          <Bot className="h-3 w-3 text-emerald-400" /> Respuesta del agente
          <span className="text-slate-600 normal-case font-semibold">{getStepDisplayName(step)}</span>
        </span>

        {showText ? (
          <div className="bg-slate-900 border border-slate-800 rounded-md p-3 text-xs text-slate-200 whitespace-pre-wrap break-words leading-relaxed max-h-64 overflow-y-auto font-sans">
            {responseText}
          </div>
        ) : showStructured ? (
          <div className="bg-slate-900 border border-slate-800 rounded-md p-2 overflow-x-auto max-h-64 overflow-y-auto">
            <ReadonlyJson data={output} />
          </div>
        ) : logs.length > 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-md p-3 text-xs text-slate-400 font-sans">
            El paso no expuso una respuesta estructurada. Revisá los logs del paso para ver la sesión.
          </div>
        ) : (
          <div className="bg-slate-900 border border-dashed border-slate-800 rounded-md p-3 text-xs text-slate-500 font-sans">
            Sin respuesta de agente registrada.
          </div>
        )}
      </div>

      {/* Agent metrics: model, tokens, cost, duration */}
      {hasMetrics && (
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5 font-sans">
            Métricas del agente
          </span>
          <div className="bg-slate-900 border border-slate-800 rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <tbody>
                {merged.model && (
                  <MetricRow icon={<Cpu className="h-3.5 w-3.5 text-sky-400" />} label="Modelo" value={merged.model} />
                )}
                {merged.inputTokens != null && (
                  <MetricRow icon={<Hash className="h-3.5 w-3.5 text-emerald-400" />} label="Tokens de entrada" value={String(merged.inputTokens)} />
                )}
                {merged.outputTokens != null && (
                  <MetricRow icon={<Hash className="h-3.5 w-3.5 text-emerald-400" />} label="Tokens de salida" value={String(merged.outputTokens)} />
                )}
                {totalTokens != null && (
                  <MetricRow icon={<Hash className="h-3.5 w-3.5 text-emerald-400" />} label="Tokens totales" value={String(totalTokens)} />
                )}
                {merged.estimatedCostUsd != null && (
                  <MetricRow icon={<Coins className="h-3.5 w-3.5 text-amber-400" />} label="Costo estimado" value={formatCost(merged.estimatedCostUsd)} />
                )}
                {merged.durationMs != null && (
                  <MetricRow icon={<Clock className="h-3.5 w-3.5 text-blue-400" />} label="Duración" value={formatDuration(merged.durationMs)} />
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const MetricRow: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <tr className="border-b border-slate-800 last:border-b-0">
    <td className="px-3 py-1.5 text-slate-500 font-sans w-1/2">{label}</td>
    <td className="px-3 py-1.5 text-slate-200 font-mono flex items-center gap-1.5">
      {icon}
      <span className="break-all">{value}</span>
    </td>
  </tr>
);