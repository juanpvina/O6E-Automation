import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Database,
  FileCode,
  GitBranch,
  Info,
  Key,
  Menu,
  RefreshCw,
  Search,
  Shield,
  Sliders,
  Terminal,
  XCircle
} from 'lucide-react';
import { Execution, Workflow, WorkflowStep } from '@opencode/shared';
import {
  getRunDurationLabel,
  getStatusColor,
  getStatusLabel,
  isHangingExecution
} from './lib/helpers';
import { EMPTY_NEW_WORKFLOW, EMPTY_PROJECT_FORM, ProjectFormState } from './lib/constants';
import { useDashboardData } from './hooks/useData';
import { useExecutionStream } from './hooks/useExecutionStream';
import { ApiReferenceConsole } from './views/ApiReferenceView';
import { DashboardView } from './views/DashboardView';
import { ExecutionsView } from './views/ExecutionsView';
import { ProjectsView } from './views/ProjectsView';
import { WorkflowsView } from './views/WorkflowsView';
import { SecretsView } from './views/SecretsView';
import { DatabasesView } from './views/DatabasesView';

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'projects' | 'workflows' | 'executions' | 'api-reference' | 'secrets' | 'databases'>('dashboard');
  const [showMainMenuInExecutions, setShowMainMenuInExecutions] = useState(false);
  const [executionSearch, setExecutionSearch] = useState('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const isExecutionsHistory = activeTab === 'executions' && !showMainMenuInExecutions;
  const isCollapsed = isSidebarCollapsed && !isExecutionsHistory;

  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileMenuOpen(false);
        mobileMenuButtonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen]);

  // Selected details
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  // Fase 5 — Currently selected step in the execution detail panel (clickable
  // steps). Reset whenever the selected execution changes. (Note: named
  // selectedExecutionStepId to avoid clashing with the designer's
  // `selectedStepId` below.)
  const [selectedExecutionStepId, setSelectedExecutionStepId] = useState<string | null>(null);

  // Database Data States (fetched + polled by the useDashboardData hook)
  const {
    projects,
    connections,
    workflows,
    schedules,
    executions,
    healthInfo,
    fetchData,
    dataError,
    isRefreshing
  } = useDashboardData(selectedExecution, setSelectedExecution);

  const tabTitles: Record<typeof activeTab, string> = {
    dashboard: 'Resumen',
    projects: 'Proyectos',
    secrets: 'Secretos',
    databases: 'Bases de datos',
    workflows: 'Workflows',
    executions: 'Ejecuciones',
    'api-reference': 'Referencia de API'
  };
  const activeProjectName = selectedExecution?.projectId
    ? projects.find(project => project.id === selectedExecution.projectId)?.name
    : undefined;

  const filteredExecutions = executions.filter(exec => {
    const searchLower = executionSearch.toLowerCase();
    const workflowName = workflows.find(w => w.id === exec.workflowId)?.name || '';
    return (
      exec.id.toLowerCase().includes(searchLower) ||
      workflowName.toLowerCase().includes(searchLower) ||
      exec.status.toLowerCase().includes(searchLower) ||
      exec.triggerType.toLowerCase().includes(searchLower)
    );
  });

  // SSE log stream for the selected execution (buffers logs + step events)
  const onStreamReset = useCallback(() => setSelectedExecutionStepId(null), []);
  const { logs, stepEvents, logEndRef, streamState, reconnectAttempt, streamError, reconnect } = useExecutionStream(selectedExecution?.id, onStreamReset);

  // Live clock tick to keep elapsed durations & hang warnings fresh
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Form creation states
  const [newProject, setNewProject] = useState<ProjectFormState>(EMPTY_PROJECT_FORM);
  const [newWorkflow, setNewWorkflow] = useState<Omit<Workflow, 'steps' | 'createdAt' | 'updatedAt'>>(EMPTY_NEW_WORKFLOW);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);

  // Designer States
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [isEditingWorkflow, setIsEditingWorkflow] = useState(false);
  const [generatedTokens, setGeneratedTokens] = useState<Record<string, string>>({});
  const [showTokenMap, setShowTokenMap] = useState<Record<string, boolean>>({});
  const [isSavingWorkflow, setIsSavingWorkflow] = useState(false);

  // 1. Notification Toast State & Helpers
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
  };

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => {
      setNotification(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [notification]);

  const handleTriggerManual = async (projectId: string | undefined, workflowId: string, customPayload?: Record<string, any>) => {
    const payload = customPayload && Object.keys(customPayload).length > 0
      ? customPayload
      : { triggeredBy: 'manual_dashboard', message: 'Manual trigger run' };
    const res = await fetch('/api/executions/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, workflowId, payload })
    }).then(r => r.json());

    if (res.executionId) {
       showNotification(`Workflow ejecutado. ID de ejecución: ${res.executionId}`, 'success');
      setActiveTab('executions');
      setShowMainMenuInExecutions(false);
      const mockExec = { id: res.executionId, status: 'queued', logs: [], artifacts: [], queuedAt: new Date().toISOString() } as unknown as Execution;
      setSelectedExecution(mockExec);
    }
  };

  const handleResolveApproval = async (executionId: string, approvalId: string, approved: boolean) => {
    await fetch(`/api/executions/${executionId}/approvals/${approvalId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved })
    });
    fetchData();
  };

  const handleEditWorkflow = (wf: Workflow) => {
    setNewWorkflow({
      id: wf.id,
      name: wf.name,
      projectId: wf.projectId,
      version: wf.version,
      isActive: wf.isActive
    });
    setWorkflowSteps(wf.steps);
    setIsEditingWorkflow(true);
    setSelectedStepId(null);
    setGeneratedTokens({});
    setActiveTab('workflows');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteWorkflow = async (id: string) => {
    await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
     showNotification('Workflow eliminado.', 'success');
    fetchData();
  };

  const handleAddWorkflowToProject = (projectId: string) => {
    setIsEditingWorkflow(false);
    setNewWorkflow({
      ...EMPTY_NEW_WORKFLOW,
      projectId: projectId
    });
    setWorkflowSteps([]);
    setSelectedStepId(null);
    setGeneratedTokens({});
    setActiveTab('workflows');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:24px_24px] bg-slate-950 font-sans text-slate-100 relative">
      {/* Toast Notification Banner */}
      {notification && (
        <div
          className="fixed top-4 right-4 z-50 animate-fade-in pointer-events-auto"
          role={notification.type === 'error' ? 'alert' : 'status'}
          aria-live={notification.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl max-w-[calc(100vw-2rem)] sm:max-w-sm backdrop-blur-md transition-all duration-300 transform scale-100 ${
            notification.type === 'success' 
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]' 
              : notification.type === 'error' 
                ? 'bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-[0_0_15px_rgba(239,68,68,0.15)]' 
                : 'bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.15)]'
          }`}>
            {notification.type === 'success' && <CheckCircle aria-hidden="true" className="h-5 w-5 text-emerald-400 shrink-0" />}
            {notification.type === 'error' && <XCircle aria-hidden="true" className="h-5 w-5 text-rose-400 shrink-0" />}
            {notification.type === 'info' && <Info aria-hidden="true" className="h-5 w-5 text-blue-400 shrink-0" />}
            <span className="text-sm font-medium pr-1 select-text">{notification.message}</span>
              <button
                type="button"
                onClick={() => setNotification(null)} 
                aria-label="Cerrar notificación"
              className="text-slate-400 hover:text-slate-100 transition-colors ml-auto font-semibold text-lg hover:bg-white/5 px-1.5 py-0.5 rounded"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      {isMobileMenuOpen && (
        <button
          type="button"
          aria-label="Cerrar menú de navegación"
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/70 md:hidden"
        />
      )}
      <aside
        id="main-navigation"
        aria-label="Navegación principal"
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-slate-900 border-r border-slate-800 flex flex-col justify-between overflow-hidden transition-all duration-300 md:relative md:z-auto md:w-64 md:translate-x-0 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } ${isCollapsed ? 'md:w-20' : ''}`}
      >
        {activeTab === 'executions' && !showMainMenuInExecutions ? (
          // Executions Sidebar
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowMainMenuInExecutions(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-100 transition px-2 py-1 bg-slate-850 hover:bg-slate-800 rounded border border-slate-700/50"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Menú Principal</span>
              </button>
            </div>
            
            <div className="p-4 border-b border-slate-800">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                <label htmlFor="execution-search" className="sr-only">Buscar ejecución</label>
                <input
                  id="execution-search"
                  type="text"
                  placeholder="Buscar ejecución..."
                  value={executionSearch}
                  onChange={(e) => setExecutionSearch(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {filteredExecutions.length === 0 ? (
                <div className="text-center py-6 flex flex-col items-center gap-2">
                  <Terminal className="h-8 w-8 text-slate-600 opacity-20" />
                  <p className="text-xs font-semibold text-slate-400">Sin ejecuciones</p>
                </div>
              ) : (
                filteredExecutions.map(exec => (
                    <button
                      type="button"
                      key={exec.id}
                      onClick={() => setSelectedExecution(exec)}
                      aria-label={`Abrir ejecución ${exec.id.slice(0, 8)}`}
                      aria-pressed={selectedExecution?.id === exec.id}
                      className={`p-3 rounded-lg border cursor-pointer transition flex flex-col gap-1.5 text-left ${
                      selectedExecution?.id === exec.id 
                        ? 'bg-emerald-500/10 border-emerald-500/40 shadow-sm' 
                        : 'bg-slate-950 border-slate-800 hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex justify-between items-center gap-1">
                       <span className="font-semibold text-slate-200 text-xs truncate">Ejecución {exec.id.slice(0, 8)}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider shrink-0 ${getStatusColor(exec.status)}`}>
                        {getStatusLabel(exec.status)}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 truncate">
                      {workflows.find(w => w.id === exec.workflowId)?.name || exec.workflowId}
                    </span>
                    <div className="text-[9px] text-slate-500 flex justify-between font-sans">
                       <span className="truncate">Origen: {exec.triggerType}</span>
                      <span>{new Date(exec.queuedAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-0.5">
                       <span className="text-[9px] text-slate-400 font-sans">Duración: <strong>{getRunDurationLabel(exec, now)}</strong></span>
                      {isHangingExecution(exec, now) && (
                        <span title="Posible ejecución colgada">
                          <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          // Main Menu / Navigation Sidebar
          <div className="flex-1 flex flex-col min-h-0">
            <div className={`p-6 border-b border-slate-800 flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
              <Activity className="h-6 w-6 text-emerald-400 shrink-0" />
              {!isCollapsed && <span className="font-bold text-lg tracking-wider truncate">OpenCode n8n</span>}
            </div>

            {activeTab === 'executions' && (
              <div className="px-4 pt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowMainMenuInExecutions(false)}
                  className={`flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg border border-emerald-500/30 transition ${
                    isCollapsed ? 'p-2.5' : 'w-full gap-2 py-2 px-4'
                  }`}
                  title="Ver ejecuciones"
                >
                  <Terminal className="h-4 w-4 shrink-0" />
                  {!isCollapsed && <span>Ver Ejecuciones ({executions.length})</span>}
                </button>
              </div>
            )}

            <nav className="p-4 space-y-1 overflow-y-auto flex-1">
                {[
                 { id: 'dashboard', label: 'Resumen', icon: Activity },
                 { id: 'projects', label: 'Proyectos', icon: Sliders },
                 { id: 'secrets', label: 'Secretos', icon: Key },
                 { id: 'databases', label: 'Bases de datos', icon: Database },
                 { id: 'workflows', label: 'Workflows', icon: GitBranch },
                 { id: 'executions', label: 'Ejecuciones', icon: Terminal },
                 { id: 'api-reference', label: 'Referencia de API', icon: FileCode }
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id as any);
                    setSelectedExecution(null);
                    setShowMainMenuInExecutions(false);
                    setIsMobileMenuOpen(false);
                  }}
                  title={tab.label}
                  aria-label={tab.label}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  className={`w-full flex items-center rounded-lg text-sm font-medium transition-all ${
                    isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-4 py-2.5'
                  } ${
                    activeTab === tab.id 
                      ? 'bg-emerald-500/10 text-emerald-400 font-semibold border-l-4 border-emerald-500' 
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                  }`}
                >
                  <tab.icon className="h-5 w-5 shrink-0" />
                  {!isCollapsed && <span>{tab.label}</span>}
                </button>
              ))}
            </nav>

            <div className="border-t border-slate-800/50 p-4">
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className={`w-full flex items-center text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 rounded-lg text-xs font-medium transition-all ${
                  isCollapsed ? 'justify-center p-2' : 'gap-3 px-4 py-2'
                }`}
                title={isCollapsed ? 'Expandir menú' : 'Colapsar menú'}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                ) : (
                  <>
                    <ChevronLeft className="h-4 w-4 shrink-0" />
                    <span>Colapsar menú</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
        <div className={`p-6 border-t border-slate-800 text-xs text-slate-500 flex flex-col ${isCollapsed ? 'items-center justify-center' : 'gap-1.5'} bg-slate-950/20`}>
          <div className={`flex items-center ${isCollapsed ? 'justify-center text-emerald-500/80' : 'gap-1.5 text-emerald-500/80'}`}>
            <Shield className="h-3.5 w-3.5 shrink-0" />
             {!isCollapsed && <span>Motor local</span>}
          </div>
           {!isCollapsed && <span>Estado: conectado</span>}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex min-w-0 flex-col overflow-hidden">
        {/* Header */}
        <header className="min-h-16 border-b border-slate-800 flex items-center justify-between gap-3 px-4 md:px-8 bg-slate-900/50">
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={mobileMenuButtonRef}
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              aria-controls="main-navigation"
              aria-expanded={isMobileMenuOpen}
              aria-label="Abrir menú de navegación"
              className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 transition hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 md:hidden"
            >
              <Menu aria-hidden="true" className="h-5 w-5" />
            </button>
           <div className="min-w-0">
             <h2 className="truncate text-lg font-semibold text-slate-100 md:text-xl">{tabTitles[activeTab]}</h2>
             <p className="truncate text-xs text-slate-400" aria-live="polite">
               {activeProjectName ? `Proyecto: ${activeProjectName}` : 'Motor local de workflows'}
             </p>
           </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              type="button"
               onClick={fetchData}
               disabled={isRefreshing}
              aria-label="Actualizar datos"
               className="btn-base icon-btn text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-60"
               title={isRefreshing ? 'Actualizando datos' : 'Actualizar datos'}
             >
               <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
             </button>
             <span className="hidden text-xs text-slate-400 sm:inline" aria-live="polite">
               {isRefreshing ? 'Actualizando...' : 'Datos al día'}
             </span>
          </div>
        </header>

        {/* Dynamic Panel Content */}
        <div className={`flex-1 ${
          activeTab === 'executions' || activeTab === 'workflows'
            ? activeTab === 'executions' ? 'overflow-y-auto p-4 md:p-6' : 'overflow-hidden p-4 md:p-6'
            : 'overflow-y-auto p-4 md:p-8'
        }`}>

          {/* DASHBOARD TAB */}
          {activeTab === 'dashboard' && (
            <DashboardView
              projects={projects}
              connections={connections}
              workflows={workflows}
              schedules={schedules}
              executions={executions}
              healthInfo={healthInfo}
              now={now}
              onResolveApproval={handleResolveApproval}
              onTriggerManual={handleTriggerManual}
              onFetchData={fetchData}
               onShowNotification={showNotification}
              onGoToProjects={() => setActiveTab('projects')}
              onGoToWorkflows={() => setActiveTab('workflows')}
              onOpenExecution={(exec) => { setSelectedExecution(exec); setActiveTab('executions'); setShowMainMenuInExecutions(false); }}
            />
          )}

          {/* PROJECTS TAB */}
          {activeTab === 'projects' && (
            <ProjectsView
              projects={projects}
              newProject={newProject}
               setNewProject={setNewProject}
               onFetchData={fetchData}
               isRefreshing={isRefreshing}
               dataError={dataError}
              workflows={workflows}
              onTriggerManual={handleTriggerManual}
              onEditWorkflow={handleEditWorkflow}
              onDeleteWorkflow={handleDeleteWorkflow}
              onAddWorkflowToProject={handleAddWorkflowToProject}
            />
          )}

          {/* SECRETS TAB */}
          {activeTab === 'secrets' && (
            <SecretsView
              projects={projects}
              onShowNotification={showNotification}
            />
          )}

          {/* DATABASES TAB */}
          {activeTab === 'databases' && (
              <DatabasesView
              onShowNotification={showNotification}
            />
          )}

          {/* WORKFLOWS TAB */}
          {activeTab === 'workflows' && (
            <WorkflowsView
              projects={projects}
              workflowSteps={workflowSteps}
              setWorkflowSteps={setWorkflowSteps}
              newWorkflow={newWorkflow}
              setNewWorkflow={setNewWorkflow}
              isEditingWorkflow={isEditingWorkflow}
              setIsEditingWorkflow={setIsEditingWorkflow}
              selectedStepId={selectedStepId}
              setSelectedStepId={setSelectedStepId}
              isSavingWorkflow={isSavingWorkflow}
              setIsSavingWorkflow={setIsSavingWorkflow}
              generatedTokens={generatedTokens}
              setGeneratedTokens={setGeneratedTokens}
              showTokenMap={showTokenMap}
              setShowTokenMap={setShowTokenMap}
              onFetchData={fetchData}
              onShowNotification={showNotification}
            />
          )}

          {/* EXECUTIONS / TIMELINE & LOGS TAB */}
          {activeTab === 'executions' && (
            <ExecutionsView
              executions={executions}
              onSelectExecution={setSelectedExecution}
              selectedExecution={selectedExecution}
              selectedExecutionStepId={selectedExecutionStepId}
              onToggleStepDetail={(stepId) => setSelectedExecutionStepId(selectedExecutionStepId === stepId ? null : stepId)}
              logs={logs}
              now={now}
              workflows={workflows}
              projects={projects}
              stepEvents={stepEvents}
              onResolveApproval={handleResolveApproval}
              logEndRef={logEndRef}
              onGoToWorkflows={() => setActiveTab('workflows')}
              onFetchData={fetchData}
              streamState={streamState}
              reconnectAttempt={reconnectAttempt}
              streamError={streamError}
              onReconnectStream={reconnect}
              dataError={dataError}
              isRefreshing={isRefreshing}
            />
          )}

          {/* API REFERENCE TAB */}
          {activeTab === 'api-reference' && (
            <ApiReferenceConsole />
          )}

        </div>
      </main>
    </div>
  );
}
