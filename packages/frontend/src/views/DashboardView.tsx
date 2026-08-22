import React from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Clock,
  Pause,
  Play,
  Plus,
  Sparkles,
  Terminal,
  Trash2,
  XCircle,
  Zap
} from 'lucide-react';
import { Connection, CronSchedule, Execution, Project, Workflow, WorkflowStep } from '@opencode/shared';
import {
  getRunDurationLabel,
  getStatusColor,
  getStatusLabel,
  getStepDisplayName,
  interpolateFrontend,
  isHangingExecution
} from '../lib/helpers';

export interface DashboardViewProps {
  projects: Project[];
  connections: Connection[];
  workflows: Workflow[];
  schedules: CronSchedule[];
  executions: Execution[];
  healthInfo: any;
  now: number;
  onResolveApproval: (executionId: string, approvalId: string, approved: boolean) => void;
  onTriggerManual: (projectId: string | undefined, workflowId: string) => void;
  onFetchData: () => void;
  onShowNotification: (message: string, type?: 'success' | 'error' | 'info') => void;
  onGoToProjects: () => void;
  onGoToWorkflows: () => void;
  onOpenExecution: (exec: Execution) => void;
}

// DASHBOARD TAB — stats, orchestrator health, onboarding, pending approvals,
// launcher & recent activity, plus webhook/schedule management panels.
export const DashboardView: React.FC<DashboardViewProps> = ({
  projects,
  connections,
  workflows,
  schedules,
  executions,
  healthInfo,
  now,
  onResolveApproval,
  onTriggerManual,
  onFetchData,
  onShowNotification,
  onGoToProjects,
  onGoToWorkflows,
  onOpenExecution
}) => {
  const handleDeleteConnection = async (id: string) => {
    await fetch(`/api/connections/${id}`, { method: 'DELETE' });
    onShowNotification('Connection deleted.', 'success');
    onFetchData();
  };

  const handleToggleSchedule = async (id: string) => {
    const sched = schedules.find(s => s.id === id);
    if (!sched) return;
    await fetch(`/api/schedules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !sched.isActive })
    });
    onFetchData();
  };

  const handleDeleteSchedule = async (id: string) => {
    await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    onShowNotification('Schedule deleted.', 'success');
    onFetchData();
  };

  return (
    <div className="space-y-8">
      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Proyectos activos', val: projects.length, desc: 'Carpetas locales de trabajo' },
          { label: 'Integraciones webhook', val: connections.length, desc: 'URLs de disparo generadas' },
          { label: 'Tareas programadas', val: schedules.filter(s => s.isActive).length, desc: 'Rutinas con temporizador activas' },
          { label: 'Ejecuciones realizadas', val: executions.length, desc: 'Historial de ejecuciones' }
        ].map((stat, idx) => (
          <div key={idx} className="bg-slate-900 border border-slate-850 p-6 rounded-xl shadow-md">
            <span className="text-sm font-medium text-slate-400">{stat.label}</span>
            <div className="text-3xl font-bold text-slate-100 mt-2">{stat.val}</div>
            <span className="text-xs text-slate-500 mt-1 block font-sans">{stat.desc}</span>
          </div>
        ))}
      </div>

      {/* Fase 4 — Orchestrator health indicator */}
      <div className="bg-slate-900 border border-slate-850 rounded-xl p-6 shadow-md">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-base font-semibold text-slate-200 flex items-center gap-2">
            <Activity className="h-4.5 w-4.5 text-emerald-400" /> Salud del orquestador
          </h3>
          {healthInfo && (
            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border ${
              healthInfo.status === 'ok'
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
            }`}>
              {healthInfo.status || 'unknown'}
            </span>
          )}
        </div>
        {healthInfo ? (
          <div className="mt-4 space-y-3 text-sm font-sans">
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg p-3">
              <span className={`h-2.5 w-2.5 rounded-full ${
                healthInfo.scheduler?.running || healthInfo.scheduler?.status === 'running' ? 'bg-emerald-400' : 'bg-slate-500'
              }`} />
              <span className="text-slate-400">Scheduler:</span>
              <strong className="text-slate-200">
                {healthInfo.scheduler?.status ?? (healthInfo.scheduler?.running ? 'running' : 'stopped')}
              </strong>
              {typeof healthInfo.scheduler?.jobs === 'number' && (
                <span className="text-slate-500 ml-auto">{healthInfo.scheduler.jobs} jobs activos</span>
              )}
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 block">Cola por proyecto</span>
              {(() => {
                const queueData = healthInfo.queue || healthInfo.queues || healthInfo.queueByProject;
                if (!queueData || typeof queueData !== 'object' || Object.keys(queueData).length === 0) {
                  return <p className="text-xs text-slate-500">Cola vacía.</p>;
                }
                return Object.entries(queueData as Record<string, any>).map(([projectId, counts]) => (
                  <div key={projectId} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-300">{projectId}</span>
                    <span className="text-slate-500">
                      {counts?.running ? `${counts.running} en ejecución · ` : ''}
                      {counts?.pending ?? counts?.queued ?? 0} en cola
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500 font-sans">
            No hay información de salud disponible. Asegurate de que el backend exponga{' '}
            <code className="font-mono text-emerald-400">/api/health</code>.
          </p>
        )}
      </div>

      {/* Onboarding guide for first use */}
      {projects.length === 0 && workflows.length === 0 && (
        <div className="bg-gradient-to-br from-emerald-500/10 to-slate-900 border border-emerald-500/20 rounded-xl p-8 shadow-md">
          <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-400" /> ¡Empezá por acá!
          </h3>
          <p className="text-sm text-slate-400 mt-1 font-sans">En 3 pasos vas a poder automatizar tus tareas. No hace falta saber programar.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm mb-2">
                <span className="h-6 w-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xs">1</span>
                Registrá un proyecto
              </div>
              <p className="text-xs text-slate-400 font-sans leading-relaxed">Contanos qué carpeta o repositorio querés automatizar. Es el punto de partida de todo.</p>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm mb-2">
                <span className="h-6 w-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xs">2</span>
                Creá un flujo desde plantilla
              </div>
              <p className="text-xs text-slate-400 font-sans leading-relaxed">Elegí una plantilla lista para usar o armá tu propio flujo paso a paso con ayuda.</p>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm mb-2">
                <span className="h-6 w-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xs">3</span>
                Ejecutalo
              </div>
              <p className="text-xs text-slate-400 font-sans leading-relaxed">Dale al botón Ejecutar y seguí el progreso en la consola. Listo, ¡está automatizado!</p>
            </div>
          </div>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              onClick={onGoToProjects}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold py-2.5 px-5 rounded-lg border border-emerald-500/30 transition flex items-center gap-2"
            >
              <Plus className="h-4 w-4" /> Registrar un proyecto
            </button>
            <button
              onClick={onGoToWorkflows}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold py-2.5 px-5 rounded-lg border border-slate-700 transition flex items-center gap-2"
            >
              <Sparkles className="h-4 w-4 text-emerald-400" /> Explorar plantillas
            </button>
          </div>
        </div>
      )}

      {/* Pending Approvals Panel */}
      <div className="bg-slate-900 border border-slate-850 rounded-xl p-6 shadow-md">
        <h3 className="text-lg font-medium text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-3">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Aprobaciones pendientes
        </h3>
        <div className="mt-4 space-y-4">
          {executions.filter(e => e.status === 'waiting_approval').length === 0 ? (
            <p className="text-sm text-slate-500 py-2">No hay ejecuciones esperando aprobación.</p>
          ) : (
            executions.filter(e => e.status === 'waiting_approval').map(exec => (
              <div key={exec.id} className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-950 p-4 border border-slate-800 rounded-lg">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-200">Ejecución {exec.id.slice(0, 8)}</span>
                    <span className="text-xs text-slate-400">({projects.find(p => p.id === exec.projectId)?.name})</span>
                  </div>
                  <p className="text-xs text-purple-400 mt-1">
                    Paso pendiente: <strong className="font-mono">{getStepDisplayName({ id: exec.pendingApprovals[0]?.approvalId || '', type: 'approval', config: {}, nextStepIds: [] } as WorkflowStep)}</strong> &middot; {interpolateFrontend(exec.pendingApprovals[0]?.description || '', exec.triggerPayload, exec.stepOutputs)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onResolveApproval(exec.id, exec.pendingApprovals[0].approvalId, true)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition"
                  >
                    <Check className="h-3.5 w-3.5" /> Aprobar
                  </button>
                  <button
                    onClick={() => onResolveApproval(exec.id, exec.pendingApprovals[0].approvalId, false)}
                    className="bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Rechazar / Cancelar
                  </button>
                  <button
                    onClick={() => onOpenExecution(exec)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded text-xs transition border border-slate-700"
                  >
                    Ver consola
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Launcher & History grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-slate-900 border border-slate-850 rounded-xl p-6 shadow-md">
          <h3 className="text-base font-semibold text-slate-200 mb-4 border-b border-slate-800 pb-3 flex items-center gap-2">
            <Play className="h-4.5 w-4.5 text-emerald-450 fill-current" /> Ejecutar flujos manualmente
          </h3>
          <div className="space-y-3 max-h-60 overflow-y-auto">
            {workflows.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-slate-500">Todavía no tenés flujos configurados.</p>
                <button
                  onClick={onGoToWorkflows}
                  className="mt-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-2 px-4 rounded-lg border border-emerald-500/30 transition"
                >
                  Crear un flujo
                </button>
              </div>
            ) : (
              workflows.map(wf => (
                <div key={wf.id} className="flex justify-between items-center bg-slate-950 p-3 rounded-lg border border-slate-850 hover:bg-slate-900/60 transition">
                  <div>
                    <span className="text-sm font-semibold text-slate-200">{wf.name}</span>
                    <span className="text-xs text-slate-500 block mt-0.5">Project: {projects.find(p => p.id === wf.projectId)?.name || wf.projectId}</span>
                  </div>
                  <button
                    onClick={() => onTriggerManual(wf.projectId, wf.id)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" /> Ejecutar flujo
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-850 rounded-xl p-6 shadow-md">
          <h3 className="text-base font-semibold text-slate-300 mb-4 border-b border-slate-800 pb-3 flex items-center gap-2">
            <Terminal className="h-4.5 w-4.5 text-blue-400" /> Actividad reciente
          </h3>
          <div className="space-y-3 max-h-60 overflow-y-auto">
            {executions.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-slate-500">Todavía no hay ejecuciones.</p>
                <p className="text-xs text-slate-600 mt-1">Ejecutá un flujo y vas a ver acá su historial.</p>
              </div>
            ) : (
              executions.slice(0, 5).map(exec => (
                <div 
                  key={exec.id} 
                  onClick={() => onOpenExecution(exec)}
                  className="flex justify-between items-center bg-slate-950 p-3 rounded-lg border border-slate-850 cursor-pointer hover:bg-slate-800/40 transition"
                >
                  <div>
                    <span className="text-sm font-semibold text-slate-300">Ejecución {exec.id.slice(0, 8)}</span>
                    <span className="text-xs text-slate-500 block mt-0.5">Disparador: {exec.triggerType} &middot; {new Date(exec.queuedAt).toLocaleTimeString()} &middot; <span className="text-slate-400">{getRunDurationLabel(exec, now)}</span></span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${getStatusColor(exec.status)}`}>
                      {getStatusLabel(exec.status)}
                    </span>
                    {isHangingExecution(exec, now) && (
                      <span className="flex items-center gap-1 text-[10px] text-amber-400 font-semibold">
                        <AlertTriangle className="h-3 w-3" /> Posible ejecución colgada
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Webhook Connections & Schedules management */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Connections */}
        <div className="bg-slate-900 border border-slate-850 rounded-xl p-6 shadow-md">
          <h3 className="text-base font-semibold text-slate-200 mb-4 border-b border-slate-800 pb-3 flex items-center gap-2">
            <Zap className="h-4.5 w-4.5 text-emerald-450" /> Conexiones webhook
          </h3>
          {connections.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">Todavía no hay conexiones webhook.</p>
          ) : (
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {connections.map(conn => (
                <div key={conn.id} className="flex justify-between items-center bg-slate-950 p-3 rounded-lg border border-slate-850 hover:bg-slate-900/60 transition">
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-slate-200 truncate block">{conn.name || conn.id}</span>
                    <span className="text-[11px] text-slate-500 block mt-0.5 truncate">
                      Project: {projects.find(p => p.id === conn.projectId)?.name || conn.projectId || '—'} · Workflow: {workflows.find(w => w.id === conn.workflowId)?.name || conn.workflowId}
                    </span>
                    <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
                      conn.authType === 'hmac'
                        ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    }`}>
                      {conn.authType === 'hmac' ? 'HMAC' : 'Bearer'} · Activa
                    </span>
                  </div>
                  <button
                    onDoubleClick={() => handleDeleteConnection(conn.id)}
                    className="text-slate-500 hover:text-rose-400 p-1.5 rounded hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition shrink-0"
                    title="Eliminar conexión (Doble clic)"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Schedules */}
        <div className="bg-slate-900 border border-slate-850 rounded-xl p-6 shadow-md">
          <h3 className="text-base font-semibold text-slate-200 mb-4 border-b border-slate-800 pb-3 flex items-center gap-2">
            <Clock className="h-4.5 w-4.5 text-emerald-450" /> Tareas programadas
          </h3>
          {schedules.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">Todavía no hay tareas programadas.</p>
          ) : (
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {schedules.map(sched => (
                <div key={sched.id} className="flex justify-between items-center bg-slate-950 p-3 rounded-lg border border-slate-850 hover:bg-slate-900/60 transition">
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-slate-200 truncate block">{sched.name || sched.id}</span>
                    <span className="text-[11px] font-mono text-emerald-400 block mt-0.5">{sched.cronExpression} · {sched.timezone}</span>
                    <span className="text-[10px] text-slate-500 block mt-0.5 truncate">
                      Workflow: {workflows.find(w => w.id === sched.workflowId)?.name || sched.workflowId}
                      {sched.nextRunAt && <> · Próxima: {new Date(sched.nextRunAt).toLocaleString()}</>}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                      sched.isActive ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-slate-500/15 text-slate-400 border-slate-600'
                    }`}>
                      {sched.isActive ? 'Activa' : 'Pausada'}
                    </span>
                    <button
                      onClick={() => handleToggleSchedule(sched.id)}
                      className={`p-1.5 rounded border transition ${
                        sched.isActive
                          ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/20'
                          : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20'
                      }`}
                      title={sched.isActive ? 'Pause schedule' : 'Activate schedule'}
                    >
                      {sched.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                    </button>
                    <button
                      onDoubleClick={() => handleDeleteSchedule(sched.id)}
                      className="text-slate-500 hover:text-rose-450 p-1.5 rounded hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition"
                      title="Eliminar tarea programada (Doble clic)"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};