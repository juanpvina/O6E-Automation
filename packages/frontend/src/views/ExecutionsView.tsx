import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  FileCode,
  Loader2,
  Terminal,
  XCircle,
  List,
  Network
  ,RefreshCw
} from 'lucide-react';
import { Execution, Project, StepEvent, Workflow, WorkflowStep } from '@opencode/shared';
import { AgentResponse } from '../components/AgentResponse';
import { StepDetailPanel } from '../components/StepDetailPanel';
import { StatusBadge } from '../components/StatusBadge';
import { FlowGraph } from '../components/FlowGraph';
import {
  getLogsForStep,
  getStatusColor,
  getStatusLabel,
  getStepDisplayName,
  getStepStatuses,
  interpolateFrontend,
  isHangingExecution
} from '../lib/helpers';
import { LogEntry, StreamState } from '../hooks/useExecutionStream';

export interface ExecutionsViewProps {
  executions: Execution[];
  onSelectExecution: (exec: Execution) => void;
  selectedExecution: Execution | null;
  selectedExecutionStepId: string | null;
  onToggleStepDetail: (stepId: string) => void;
  logs: LogEntry[];
  now: number;
  workflows: Workflow[];
  projects: Project[];
  stepEvents: StepEvent[];
  onResolveApproval: (executionId: string, approvalId: string, approved: boolean) => void;
  logEndRef: React.MutableRefObject<HTMLDivElement | null>;
  onGoToWorkflows: () => void;
  onFetchData?: () => void;
  streamState?: StreamState;
  reconnectAttempt?: number;
  streamError?: string | null;
  dataError?: string | null;
  isRefreshing?: boolean;
  onReconnectStream?: () => void;
}

const levelClass = (level: string): string => {
  if (level === 'error') return 'bg-rose-500/15 text-rose-400';
  if (level === 'warn') return 'bg-amber-500/15 text-amber-400';
  return 'bg-emerald-500/15 text-emerald-400';
};

const logLine = (log: LogEntry) => (
  <div key={`${log.timestamp}\u0000${log.message}`} className="flex gap-2.5 items-start">
    <span className="text-slate-600 text-[10px] select-none shrink-0 pt-0.5">{new Date(log.timestamp).toLocaleTimeString()}</span>
    <span className={`px-1.5 rounded text-[9px] font-bold uppercase shrink-0 ${levelClass(log.level)}`}>
      {log.level}
    </span>
    <span className="flex-1 whitespace-pre-wrap break-words leading-relaxed select-text">{log.message}</span>
  </div>
);

// EXECUTIONS / TIMELINE & LOGS TAB — history list, live console stream,
// visual step tracker with clear status checks and per-step detail side panel.
export const ExecutionsView: React.FC<ExecutionsViewProps> = ({
  selectedExecution,
  selectedExecutionStepId,
  onToggleStepDetail,
  logs,
  now,
  workflows,
  projects,
  stepEvents,
  onResolveApproval,
  logEndRef,
  onFetchData,
  streamState = 'idle',
  reconnectAttempt = 0,
  streamError,
  dataError,
  isRefreshing = false
  ,onReconnectStream
}) => {
  const [consoleMode, setConsoleMode] = useState<'general' | 'step'>('general');
  const [consoleCollapsed, setConsoleCollapsed] = useState(false);
  const [execViewMode, setExecViewMode] = useState<'list' | 'graph'>('graph');

  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const [isNearLogEnd, setIsNearLogEnd] = useState(true);
  const [unseenLogs, setUnseenLogs] = useState(0);

  useEffect(() => {
    const container = logScrollRef.current;
    if (!container) return;
    const updatePosition = () => {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      const nearEnd = distance <= 96;
      setIsNearLogEnd(nearEnd);
      if (nearEnd) setUnseenLogs(0);
    };
    updatePosition();
    container.addEventListener('scroll', updatePosition, { passive: true });
    return () => container.removeEventListener('scroll', updatePosition);
  }, [selectedExecution?.id, consoleMode, consoleCollapsed]);

  useEffect(() => {
    if (logs.length === 0 || isNearLogEnd) return;
    setUnseenLogs(count => count + 1);
  }, [logs.length, isNearLogEnd]);

  const goToLogEnd = () => {
    const container = logScrollRef.current;
    if (!container) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({ top: container.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
    setUnseenLogs(0);
    setIsNearLogEnd(true);
  };

  useEffect(() => {
    setUnseenLogs(0);
    setIsNearLogEnd(true);
  }, [selectedExecution?.id]);

  const execWorkflow = useMemo(
    () => selectedExecution ? workflows.find(w => w.id === selectedExecution.workflowId) : null,
    [selectedExecution, workflows]
  );
  const stepStatuses = useMemo(
    () => execWorkflow && selectedExecution ? getStepStatuses(execWorkflow, selectedExecution, logs, stepEvents) : null,
    [execWorkflow, selectedExecution, logs, stepEvents]
  );
  const selectedStep = useMemo(
    () => execWorkflow && selectedExecutionStepId
      ? execWorkflow.steps.find(s => s.id === selectedExecutionStepId)
      : null,
    [execWorkflow, selectedExecutionStepId]
  );

  const displayedLogs = useMemo(
    () => consoleMode === 'step' && selectedExecutionStepId && selectedExecution
      ? getLogsForStep(selectedExecutionStepId, logs, selectedExecution.stepTimings)
      : logs,
    [consoleMode, selectedExecutionStepId, selectedExecution, logs]
  );

  const modeBtn = (mode: 'general' | 'step') =>
    `px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition ${
      consoleMode === mode ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-500 hover:text-slate-300'
    }`;

  if (!selectedExecution) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 py-20 text-center flex-col bg-slate-900 border border-slate-800 rounded-xl shadow-md">
        <Terminal className="h-12 w-12 text-slate-600 opacity-20 mb-3" />
        <span className="text-slate-400 font-medium">Elegí una ejecución en el panel izquierdo para ver su consola y detalles.</span>
      </div>
    );
  }

  return (
       <div className="flex flex-col gap-6 w-full min-h-full">
      {/* Top Section: Progress & FlowGraph */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow-md w-full">
        {/* Header of execution status */}
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
          <div>
            <h4 className="font-bold text-slate-200 text-sm">Consola de ejecución: {selectedExecution.id}</h4>
           <span className="text-xs text-slate-500">Project Workspace: {projects.find(p => p.id === selectedExecution.projectId)?.name}</span>
           <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-mono" aria-live="polite">
             <span className={`rounded border px-1.5 py-0.5 ${streamState === 'connected' ? 'border-emerald-500/30 text-emerald-400' : streamState === 'error' ? 'border-amber-500/30 text-amber-400' : 'border-slate-700 text-slate-500'}`}>
               SSE: {streamState}
             </span>
             {reconnectAttempt > 0 && <span className="text-slate-500">intento {reconnectAttempt}</span>}
             {isRefreshing && <span className="text-slate-500">actualizando...</span>}
             {streamState === 'error' && onReconnectStream && (
               <button type="button" onClick={onReconnectStream} className="inline-flex min-h-11 items-center gap-1 rounded border border-amber-500/30 px-3 text-amber-300 hover:bg-amber-500/10" aria-label="Reconectar stream de logs">
                 <RefreshCw className="h-3 w-3" /> Reconectar
               </button>
             )}
           </div>
           </div>
          <div className="flex items-center gap-3">
            {isHangingExecution(selectedExecution, now) && (
              <span className="flex items-center gap-1 text-[10px] text-amber-400 font-semibold bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded">
                <AlertTriangle className="h-3 w-3 animate-pulse" /> Posible ejecución colgada
              </span>
            )}
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(selectedExecution.status)}`}>
              {getStatusLabel(selectedExecution.status)}
            </span>
          </div>
        </div>

        {/* Failed execution error banner */}
        {selectedExecution.status === 'failed' && (
          <div className="px-6 py-4 bg-rose-600 border-b border-rose-700 flex items-start gap-3 font-sans">
            <AlertTriangle className="h-5 w-5 text-white shrink-0 mt-0.5" />
            <div className="min-w-0">
              <span className="block text-sm font-bold text-white uppercase tracking-wide">La ejecución falló</span>
              <span className="block text-[13px] text-rose-50 mt-1 break-words">
                {selectedExecution.errorMessage
                  ? selectedExecution.errorMessage
                  : 'La ejecución falló. Revisá los logs para más detalles.'}
              </span>
            </div>
          </div>
        )}

         {(streamError || dataError) && (
          <div className="px-6 py-2 bg-amber-500/5 border-b border-amber-500/20 text-xs text-amber-300" role="status">
            {streamError || `Actualización: ${dataError}`}
          </div>
        )}

        {/* Visual Step Tracker / Graph */}
        {execWorkflow && stepStatuses && (
          <div className="p-4 bg-slate-950 border-b border-slate-800 text-left font-sans">
            <div className="flex items-center justify-between mb-3">
               <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block font-sans">
                 Progreso de la ejecución
               </span>
              <div className="flex bg-slate-900 rounded border border-slate-800 p-0.5 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setExecViewMode('list')}
                   className={`min-h-11 px-3 rounded transition flex items-center gap-1 ${
                    execViewMode === 'list' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 border border-transparent'
                  }`}
                >
                  <List className="h-3 w-3" /> Lista
                </button>
                <button
                  type="button"
                  onClick={() => setExecViewMode('graph')}
                   className={`min-h-11 px-3 rounded transition flex items-center gap-1 ${
                    execViewMode === 'graph' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 border border-transparent'
                  }`}
                >
                  <Network className="h-3 w-3" /> Grafo
                </button>
              </div>
            </div>

            {execViewMode === 'graph' ? (
               <div className="relative w-full border border-slate-800 rounded-lg bg-slate-950/40 overflow-hidden">
                 <div className="w-full h-[clamp(360px,60vh,720px)] overflow-hidden relative">
                  <FlowGraph
                    steps={execWorkflow.steps}
                    selectedStepId={selectedExecutionStepId}
                    onSelectStep={(stepId) => onToggleStepDetail(stepId)}
                    stepStatuses={stepStatuses}
                  />
                </div>
               </div>
            ) : (
              <div className="flex items-center gap-2 overflow-x-auto pb-2 pr-2">
                {execWorkflow.steps.map((step, idx) => {
                  const status = stepStatuses[step.id] || 'pending';

                  let icon: React.ReactNode;
                  if (status === 'succeeded') icon = <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
                  else if (status === 'failed') icon = <XCircle className="h-4 w-4 text-rose-500 shrink-0" />;
                  else if (status === 'waiting_approval') icon = <AlertTriangle className="h-4 w-4 text-purple-400 animate-pulse shrink-0" />;
                  else if (status === 'running') icon = <Loader2 className="h-4 w-4 text-blue-400 animate-spin shrink-0" />;
                  else icon = <Circle className="h-4 w-4 text-slate-600 shrink-0" />;

                  const badgeColor =
                    status === 'succeeded' ? 'bg-emerald-500/10 border-emerald-500/20'
                    : status === 'failed' ? 'bg-rose-500/10 border-rose-500/20'
                    : status === 'waiting_approval' ? 'bg-purple-500/10 border-purple-500/20 animate-pulse'
                    : status === 'running' ? 'bg-blue-500/10 border-blue-500/20 animate-pulse'
                    : 'bg-slate-900 border-slate-800';

                  let stepErrorShort: string | null = null;
                  if (status === 'failed') {
                    const stepOutput = selectedExecution.stepOutputs?.[step.id];
                    const rawErr = stepOutput?.error || stepOutput?.errorMessage || selectedExecution.errorMessage || '';
                    if (rawErr) stepErrorShort = String(rawErr).slice(0, 80);
                  }

                  return (
                    <React.Fragment key={step.id}>
                      <button
                        type="button"
                        onClick={() => onToggleStepDetail(step.id)}
                        title="Ver detalle del paso"
                         className={`min-h-11 flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-sans shrink-0 text-left transition ${badgeColor} ${status === 'failed' ? 'ring-2 ring-rose-500/40' : ''} ${selectedExecutionStepId === step.id ? 'ring-2 ring-emerald-500/50 cursor-default' : 'hover:border-slate-600 hover:bg-slate-800/40 cursor-pointer'}`}
                      >
                        {icon}
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-xs text-slate-200">{getStepDisplayName(step)}</span>
                          <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-500">{step.type}</span>
                          <StatusBadge status={status} />
                          {stepErrorShort && (
                            <span className="text-[9px] text-rose-400 font-mono max-w-[180px] truncate" title={stepErrorShort}>
                              {stepErrorShort}
                            </span>
             )}
            </div>
                        <span className={`text-[9px] font-mono shrink-0 ${selectedExecutionStepId === step.id ? 'text-emerald-400' : 'text-slate-600'}`}>
                          {selectedExecutionStepId === step.id ? '✕' : '⋯'}
                        </span>
                      </button>
               {idx < execWorkflow.steps.length - 1 && (
                        <ChevronRight className={`h-4 w-4 shrink-0 ${
                          status === 'succeeded' ? 'text-emerald-400' : status === 'failed' ? 'text-rose-500' : 'text-slate-700'
                        }`} />
               )}
             </React.Fragment>
           );
         })}
       </div>
             )}
             <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-800 pt-3 text-[11px] text-slate-300" aria-label="Leyenda de estados">
               <span className="font-semibold text-slate-200">Estados:</span>
               {(['pending', 'running', 'succeeded', 'failed', 'waiting_approval'] as const).map(status => (
                 <span key={status} className="inline-flex items-center gap-1.5">
                   <span className={`h-2.5 w-2.5 rounded-full ${status === 'succeeded' ? 'bg-emerald-400' : status === 'failed' ? 'bg-rose-400' : status === 'running' ? 'bg-blue-400' : status === 'waiting_approval' ? 'bg-amber-400' : 'bg-slate-500'}`} aria-hidden="true" />
                   <StatusBadge status={status} />
                 </span>
               ))}
             </div>
           </div>
        )}

        {/* Render artifacts list if the execution has them */}
        {selectedExecution.artifacts && selectedExecution.artifacts.length > 0 && (
          <div className="p-4 bg-slate-950/70 border-b border-slate-800 text-xs text-slate-400 space-y-2 flex flex-col justify-start">
            <div className="flex flex-col gap-1">
              <span className="text-slate-400 font-semibold mb-1">Generated report artifacts:</span>
               {selectedExecution.artifacts.map(art => (
                 <div key={art} className="flex items-center gap-1 font-mono text-[10px] bg-slate-900 px-2.5 py-1 border border-slate-800 rounded">
                  <FileCode className="h-3.5 w-3.5 text-blue-400" />
                  <span className="select-all break-all">{art}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Final agent response summary (once the execution completed) */}
        {(() => {
          if (selectedExecution.status !== 'succeeded' || !execWorkflow) return null;
          const agentSteps = execWorkflow.steps.filter(s => s.type === 'agent');
          if (agentSteps.length === 0) return null;
          const lastAgent = agentSteps[agentSteps.length - 1];
          const output = selectedExecution.stepOutputs?.[lastAgent.id];
          const metrics = selectedExecution.agentMetrics?.[lastAgent.id];
          if (output === undefined && !metrics) return null;
          return (
            <div className="px-4 py-4 bg-slate-900 border-b border-slate-800">
              <div className="flex items-center gap-2 text-emerald-400 font-sans mb-3">
                <Bot className="h-4 w-4" />
                <span className="font-bold text-xs uppercase tracking-wider">Respuesta final del agente</span>
                <span className="text-[10px] text-slate-500 font-semibold normal-case">({getStepDisplayName(lastAgent)})</span>
              </div>
              <AgentResponse
                step={lastAgent}
                output={output}
                metrics={metrics}
                logs={getLogsForStep(lastAgent.id, logs, selectedExecution.stepTimings)}
              />
            </div>
          );
        })()}
      </div>

      {/* Bottom Section: Console Log Stream & Inspector Detalle del Paso (StepDetailPanel) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow-md w-full">
         {/* Keep the console visible beside the inspector so selecting a step never hides debug context. */}
          <div className="flex flex-col md:flex-row md:min-h-[420px]">
           {/* Console Area */}
           <div className={`flex flex-col min-h-0 border-r border-slate-800 ${selectedStep ? 'md:w-1/2' : 'flex-1'}`}>
               <div className="px-4 py-3 bg-slate-900/70 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-sans">
                  <Terminal className="h-3.5 w-3.5 text-slate-400" /> Consola de Logs {selectedExecutionStepId ? `(Paso: ${getStepDisplayName(selectedStep || { id: selectedExecutionStepId, type: 'agent', config: {}, nextStepIds: [] } as WorkflowStep)})` : ''}
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-md border border-slate-800 bg-slate-950 overflow-hidden">
                     <button type="button" onClick={() => setConsoleMode('general')} className={`min-h-11 ${modeBtn('general')}`} aria-pressed={consoleMode === 'general'}>
                      Stream general
                    </button>
                     <button type="button" onClick={() => setConsoleMode('step')} className={`min-h-11 ${modeBtn('step')}`} aria-pressed={consoleMode === 'step'}>
                      Por paso
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConsoleCollapsed(c => !c)}
                    title={consoleCollapsed ? 'Expandir consola' : 'Colapsar consola'}
                     className="icon-btn text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                  >
                    {consoleCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>

               {!consoleCollapsed && (
                 <div ref={logScrollRef} className="relative max-h-[min(55vh,520px)] overflow-y-auto p-4 font-mono text-xs text-slate-300 space-y-2 bg-slate-950 min-h-[220px]">
                   {!isNearLogEnd && (
                     <button type="button" onClick={goToLogEnd} className="sticky top-2 z-10 mx-auto flex min-h-11 items-center gap-2 rounded-full border border-emerald-500/40 bg-slate-900 px-4 text-xs font-semibold text-emerald-300 shadow-lg hover:bg-slate-800" aria-label="Ir al final de los logs">
                       <ChevronDown className="h-4 w-4" /> {unseenLogs > 0 ? `${unseenLogs} nuevos logs` : 'Ir al final'}
                     </button>
                   )}
                   {displayedLogs.length === 0 ? (
                    consoleMode === 'step' && !selectedExecutionStepId ? (
                      <div className="text-slate-500 text-xs py-6 text-center font-sans">
                        Modo "Por paso": seleccioná un paso en el tracker para ver solo sus logs.
                      </div>
                    ) : (
                      <div className="text-slate-500 text-xs py-6 text-center font-sans">
                         {streamState === 'connecting' || streamState === 'reconnecting' ? 'Conectando al stream de logs...' : streamState === 'error' ? 'No se pudo conectar al stream. Usá “Reconectar” para volver a intentarlo.' : 'Esta ejecución todavía no tiene logs.'}
                      </div>
                    )
                  ) : (
                    displayedLogs.map(logLine)
                  )}
                   <div ref={logEndRef} />
                 </div>
              )}
           </div>

           {/* Inspector Detalle del Paso (StepDetailPanel) */}
           {selectedStep && stepStatuses && (
             <div className="w-full md:w-1/2 flex-1 flex flex-col overflow-y-auto min-h-0 bg-slate-900/50">
              <StepDetailPanel
                step={selectedStep}
                execution={selectedExecution}
                workflow={execWorkflow}
                stepStatuses={stepStatuses}
                logs={logs}
                onClose={() => onToggleStepDetail(selectedStep.id)}
                onFetchData={onFetchData}
              />
            </div>
          )}
        </div>
      </div>

      {/* Actions box for waiting approval */}
      {selectedExecution.status === 'waiting_approval' && (
        <div className="p-6 bg-slate-950 border border-slate-800 rounded-xl shadow-md border-t-4 border-t-purple-500/60">
          <div className="flex items-center gap-2 text-purple-400 font-sans mb-2">
            <AlertTriangle className="h-5 w-5 animate-pulse text-purple-400" />
            <span className="font-bold text-sm uppercase tracking-wide">Aprobación pendiente de una persona</span>
          </div>
          <p className="text-sm text-slate-200 font-sans mb-4 pl-7">
            {interpolateFrontend(selectedExecution.pendingApprovals[0]?.description || '', selectedExecution.triggerPayload, selectedExecution.stepOutputs)}
          </p>
          <div className="flex flex-wrap gap-3 pl-7">
            <button
              onClick={() => onResolveApproval(selectedExecution.id, selectedExecution.pendingApprovals[0].approvalId, true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded text-sm font-bold flex items-center gap-2 transition"
            >
              <Check className="h-4 w-4" /> Aprobar y continuar
            </button>
            <button
              onClick={() => onResolveApproval(selectedExecution.id, selectedExecution.pendingApprovals[0].approvalId, false)}
              className="bg-rose-600 hover:bg-rose-500 text-white px-5 py-2.5 rounded text-sm font-bold flex items-center gap-2 transition"
            >
              <XCircle className="h-4 w-4" /> Rechazar / Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Hang warning banner for stuck executions */}
      {isHangingExecution(selectedExecution, now) && (
        <div className="px-6 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex flex-wrap items-center justify-between gap-2 text-sm font-sans">
          <span className="flex items-center gap-2 text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            Esta ejecución lleva más de 5 minutos sin terminar. Probablemente se quedó colgada.
          </span>
          <span className="text-xs text-slate-400">Si sigue así, contactá al equipo técnico para que la marque como fallida o cancele la tarea.</span>
        </div>
      )}
    </div>
  );
};
