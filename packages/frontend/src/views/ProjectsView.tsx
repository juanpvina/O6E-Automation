import React, { useState } from 'react';
import { Plus, Sliders, Trash2, Play, ChevronRight, Boxes } from 'lucide-react';
import { Project, Workflow } from '@opencode/shared';
import { EMPTY_PROJECT_FORM, ProjectFormState } from '../lib/constants';

export interface ProjectsViewProps {
  projects: Project[];
  newProject: ProjectFormState;
  setNewProject: React.Dispatch<React.SetStateAction<ProjectFormState>>;
  onFetchData: () => void;
  isRefreshing: boolean;
  dataError: string | null;
  workflows: Workflow[];
  onTriggerManual: (projectId: string | undefined, workflowId: string) => void;
  onEditWorkflow: (wf: Workflow) => void;
  onDeleteWorkflow: (id: string) => Promise<void>;
  onAddWorkflowToProject: (projectId: string) => void;
}

// PROJECTS TAB — register new local projects and manage their secrets.
export const ProjectsView: React.FC<ProjectsViewProps> = ({
  projects,
  newProject,
  setNewProject,
  onFetchData,
  isRefreshing,
  dataError,
  workflows,
  onTriggerManual,
  onEditWorkflow,
  onDeleteWorkflow,
  onAddWorkflowToProject
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProject.id.trim() || !newProject.name.trim() || !newProject.localPath.trim() || !newProject.baseBranch.trim()) {
      setRequestError('Completa los campos obligatorios antes de guardar.');
      return;
    }
    setIsSubmitting(true);
    setRequestError(null);
    const proj: Project = {
      id: newProject.id,
      name: newProject.name,
      localPath: newProject.localPath,
      gitRemoteUrl: newProject.gitRemoteUrl,
      baseBranch: newProject.baseBranch,
      allowedCommands: newProject.allowedCommands.split(',').map(s => s.trim()).filter(Boolean),
      policy: {
        maxExecutionTimeSeconds: Number(newProject.maxExecutionTimeSeconds) || 600,
        concurrencyMode: newProject.concurrencyMode,
        requireApprovalForDestructiveActions: newProject.requireApprovalForDestructiveActions
      },
      createdAt: '',
      updatedAt: ''
    };
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proj)
      });
      if (!response.ok) throw new Error(`No se pudo registrar el proyecto (${response.status}).`);
      setNewProject(EMPTY_PROJECT_FORM);
      onFetchData();
      setIsModalOpen(false);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'No se pudo registrar el proyecto.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!window.confirm('¿Eliminar este proyecto? También puede afectar sus workflows asociados.')) return;
    setRequestError(null);
    try {
      const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`No se pudo eliminar el proyecto (${response.status}).`);
      onFetchData();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'No se pudo eliminar el proyecto.');
    }
  };

  const unassociatedWorkflows = workflows.filter(wf => {
    if (!wf.projectId) return true;
    return !projects.some(p => p.id === wf.projectId);
  });

  return (
    <div className="space-y-8">
      {/* Header section with trigger button */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Sliders aria-hidden="true" className="h-5 w-5 text-emerald-400" /> Proyectos locales
          </h3>
            <p className="mt-1 text-sm text-slate-300">Configura y gestiona las carpetas de tus proyectos y sus credenciales.</p>
        </div>
        <button
          type="button"
          onClick={() => { setRequestError(null); setIsModalOpen(true); }}
          className="btn-base bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-4 rounded-lg border border-emerald-500/30 transition flex items-center gap-1.5"
        >
          <Plus aria-hidden="true" className="h-4 w-4" /> Registrar proyecto
        </button>
      </div>

      {/* Floating Project Registration Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={() => !isSubmitting && setIsModalOpen(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl relative" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => !isSubmitting && setIsModalOpen(false)}
              aria-label="Cerrar formulario de proyecto"
              className="icon-btn absolute right-3 top-3 text-slate-400 hover:text-slate-100 text-2xl leading-none font-semibold"
            >
              &times;
            </button>
            <h3 className="text-lg font-medium text-slate-100 mb-4 border-b border-slate-700 pb-3">Registrar proyecto local</h3>
            {requestError && <p role="alert" className="mb-4 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{requestError}</p>}
            <form onSubmit={handleCreateProject} className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                 <label htmlFor="project-id" className="block text-sm font-semibold text-slate-300 mb-1">ID del proyecto *</label>
                <input
                  type="text"
                   id="project-id" placeholder="p. ej. proyecto-a"
                  value={newProject.id}
                  onChange={e => setNewProject({ ...newProject, id: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                   className="control-base w-full p-2 text-sm font-mono"
                  required
                />
              </div>
              <div>
                 <label htmlFor="project-name" className="block text-sm font-semibold text-slate-300 mb-1">Nombre visible *</label>
                <input
                  type="text"
                   id="project-name" placeholder="p. ej. Sitio web"
                  value={newProject.name}
                  onChange={e => setNewProject({ ...newProject, name: e.target.value })}
                   className="control-base w-full p-2 text-sm"
                  required
                />
              </div>
              <div>
                 <label htmlFor="project-branch" className="block text-sm font-semibold text-slate-300 mb-1">Rama base *</label>
                <input
                  type="text"
                   id="project-branch" placeholder="main"
                  value={newProject.baseBranch}
                  onChange={e => setNewProject({ ...newProject, baseBranch: e.target.value })}
                   className="control-base w-full p-2 text-sm font-mono"
                  required
                />
              </div>
              <div className="md:col-span-2">
                 <label htmlFor="project-path" className="block text-sm font-semibold text-slate-300 mb-1">Ruta absoluta local *</label>
                <input
                  type="text"
                   id="project-path" placeholder="p. ej. C:\\Users\\tu-nombre\\Projects\\mi-app"
                  value={newProject.localPath}
                  onChange={e => setNewProject({ ...newProject, localPath: e.target.value })}
                   className="control-base w-full p-2 text-sm font-mono"
                  required
                />
              </div>
              <div>
                 <label htmlFor="project-remote" className="block text-sm font-semibold text-slate-300 mb-1">URL remota de Git (opcional)</label>
                <input
                  type="text"
                   id="project-remote" placeholder="git@github.com:usuario/repo.git"
                  value={newProject.gitRemoteUrl}
                  onChange={e => setNewProject({ ...newProject, gitRemoteUrl: e.target.value })}
                   className="control-base w-full p-2 text-sm font-mono"
                />
              </div>
              <div className="md:col-span-3">
                 <label htmlFor="project-commands" className="block text-sm font-semibold text-slate-300 mb-1">Prefijos de comandos permitidos (separados por coma)</label>
                <input
                  type="text"
                   id="project-commands" placeholder="npm test, pytest, cargo test"
                  value={newProject.allowedCommands}
                  onChange={e => setNewProject({ ...newProject, allowedCommands: e.target.value })}
                   className="control-base w-full p-2 text-sm font-mono"
                />
              </div>

              {/* Execution policy */}
              <div className="md:col-span-3 bg-slate-955 border border-slate-800 rounded-lg p-4">
                 <span className="text-sm font-bold text-slate-300 block mb-3">Política de ejecución</span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                     <label htmlFor="project-concurrency" className="block text-sm font-semibold text-slate-300 mb-1">Modo de concurrencia</label>
                    <select
                      value={newProject.concurrencyMode}
                      onChange={e => setNewProject({ ...newProject, concurrencyMode: e.target.value as 'serialize' | 'reject' })}
                       id="project-concurrency" className="control-base w-full p-2 text-sm"
                    >
                      <option value="serialize">Serialize (queue up runs)</option>
                      <option value="reject">Reject (drop event if busy)</option>
                    </select>
                  </div>
                  <div>
                     <label htmlFor="project-timeout" className="block text-sm font-semibold text-slate-300 mb-1">Tiempo máximo (segundos)</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="600"
                      value={newProject.maxExecutionTimeSeconds}
                      onChange={e => setNewProject({ ...newProject, maxExecutionTimeSeconds: Number(e.target.value) })}
                       id="project-timeout" className="control-base w-full p-2 text-sm font-mono"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={newProject.requireApprovalForDestructiveActions}
                        onChange={e => setNewProject({ ...newProject, requireApprovalForDestructiveActions: e.target.checked })}
                        className="rounded bg-slate-900 border-slate-800 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-slate-900 h-4 w-4"
                      />
                      <span className="text-sm font-semibold text-slate-350">Require approval for destructive actions</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="md:col-span-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => !isSubmitting && setIsModalOpen(false)}
                  className="btn-base bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 text-sm font-semibold transition"
                >
                  Cancelar
                </button>
                <button type="submit" disabled={isSubmitting} className="btn-base bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 text-sm font-semibold flex items-center gap-1 transition">
                  <Plus aria-hidden="true" className="h-4 w-4" /> {isSubmitting ? 'Guardando...' : 'Guardar proyecto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Projects List */}
      {dataError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200"><span>No se pudieron cargar los proyectos: {dataError}</span><button type="button" onClick={onFetchData} className="btn-base border border-rose-400/50 px-3 text-sm hover:bg-rose-500/20">Reintentar</button></div>}
      {isRefreshing && <p className="text-sm text-slate-300" role="status">Cargando proyectos...</p>}
      {requestError && !isModalOpen && <p role="alert" className="text-sm text-rose-300">{requestError}</p>}
      <div className="space-y-6">
        {projects.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center flex flex-col items-center">
            <Sliders className="h-12 w-12 mb-3 opacity-20 text-slate-400" />
            <p className="text-base font-semibold text-slate-200">Todavía no hay proyectos registrados</p>
            <p className="text-sm text-slate-500 mt-1 max-w-[380px]">Completá el formulario haciendo clic en el botón de arriba para agregar tu primer proyecto y empezar a automatizar.</p>
          </div>
        ) : (
          projects.map(proj => {
            const projectWorkflows = workflows.filter(wf => wf.projectId === proj.id);

            return (
              <div key={proj.id} className="bg-slate-900 border border-slate-850 p-6 rounded-xl relative shadow-md">
                <button
                  type="button"
                  onClick={() => handleDeleteProject(proj.id)}
                  aria-label={`Eliminar proyecto ${proj.name}`}
                  className="btn-base icon-btn absolute right-4 top-4 text-slate-300 hover:text-rose-300 bg-slate-950 hover:bg-rose-500/10 border border-slate-800 transition"
                  title="Eliminar proyecto"
                >
                  <Trash2 className="h-4 w-4" />
                </button>

                <h4 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  {proj.name} 
                  <span className="text-xs text-slate-500 font-mono bg-slate-950 px-2 py-0.5 rounded">ID: {proj.id}</span>
                </h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 text-sm text-slate-350">
                  <div className="space-y-2">
                    <div>
                      <strong className="text-slate-400 block text-xs mb-0.5">Local folder path:</strong> 
                      <span className="font-mono bg-slate-950 px-2 py-1 rounded text-xs select-all block w-fit border border-slate-850">{proj.localPath}</span>
                    </div>
                    {proj.gitRemoteUrl && (
                      <div>
                        <strong className="text-slate-400 block text-xs mb-0.5">Git Origin:</strong> 
                        <span className="font-mono bg-slate-950 px-2 py-1 rounded text-xs select-all block w-fit border border-slate-850">{proj.gitRemoteUrl}</span>
                      </div>
                    )}
                    <div>
                      <strong className="text-slate-400 block text-xs mb-0.5">Base branch:</strong> 
                      <span className="font-mono text-emerald-455 bg-slate-950 px-2 py-0.5 rounded text-xs border border-slate-850">{proj.baseBranch}</span>
                    </div>
                  </div>
                  <div>
                    <strong className="text-slate-400 block text-xs mb-1.5">Pre-authorized command prefixes:</strong>
                    <div className="flex flex-wrap gap-1.5">
                      {proj.allowedCommands.map((cmd, idx) => (
                        <span key={idx} className="bg-slate-950 border border-slate-800 px-2.5 py-1 rounded text-xs font-mono text-slate-300 shadow-sm">{cmd}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Integrated Workflows segment */}
                <div className="mt-6 border-t border-slate-800 pt-6">
                  <h5 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-1.5">
                    Workflows Asociados
                  </h5>
                  {projectWorkflows.length === 0 ? (
                    <div className="bg-slate-950 p-4 border border-slate-850 rounded-lg text-center">
                      <p className="text-xs text-slate-500">Este proyecto no tiene workflows asociados.</p>
                      <button
                        onClick={() => onAddWorkflowToProject(proj.id)}
                        className="mt-2 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-1.5 px-3 rounded transition flex items-center gap-1 mx-auto"
                      >
                        <Plus className="h-3 w-3" /> Nuevo Workflow
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {projectWorkflows.map(wf => (
                        <div key={wf.id} className="bg-slate-950 border border-slate-850 p-4 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-200">{wf.name}</span>
                              <span className="text-[10px] bg-slate-900 text-slate-450 border border-slate-800 px-1.5 py-0.5 rounded font-mono">ID: {wf.id}</span>
                              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono">v{wf.version}</span>
                            </div>
                            
                            {/* Steps chain */}
                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                              {wf.steps.map((step, idx) => (
                                <React.Fragment key={step.id}>
                                  <div className="bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-[10px] font-mono text-slate-300 flex items-center gap-1">
                                    <span className="text-slate-400 font-bold">{step.id}</span>
                                    <span className="text-slate-500 text-[9px] uppercase">({step.type})</span>
                                  </div>
                                  {idx < wf.steps.length - 1 && (
                                    <ChevronRight className="h-3 w-3 text-slate-600" />
                                  )}
                                </React.Fragment>
                              ))}
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => onTriggerManual(proj.id, wf.id)}
                              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-2.5 py-1.5 rounded font-semibold transition flex items-center gap-1"
                              title="Ejecutar workflow"
                            >
                              <Play className="h-3 w-3 fill-current" /> Run
                            </button>
                            <button
                              onClick={() => onEditWorkflow(wf)}
                              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded font-semibold border border-slate-700 transition"
                              title="Editar workflow"
                            >
                              Editar
                            </button>
                            <button
                               onClick={() => window.confirm(`¿Eliminar el workflow "${wf.name}"?`) && onDeleteWorkflow(wf.id)}
                               aria-label={`Eliminar workflow ${wf.name}`}
                               className="btn-base icon-btn bg-slate-800 hover:bg-rose-500/10 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/20 transition"
                               title="Eliminar workflow"
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
            );
          })
        )}

        {/* Workflows sin Proyecto Asociado */}
        {unassociatedWorkflows.length > 0 && (
          <div className="bg-slate-900 border border-slate-850 p-6 rounded-xl relative shadow-md border-dashed">
            <h4 className="text-base font-bold text-slate-100 flex items-center gap-2 mb-4">
              <Boxes className="h-5 w-5 text-amber-500" /> Workflows sin Proyecto Asociado
              <span className="text-xs text-slate-500 bg-slate-950 px-2 py-0.5 rounded font-normal">Huérfanos</span>
            </h4>
            <div className="space-y-3">
              {unassociatedWorkflows.map(wf => (
                <div key={wf.id} className="bg-slate-950 border border-slate-850 p-4 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-200">{wf.name}</span>
                      <span className="text-[10px] bg-slate-900 text-slate-450 border border-slate-800 px-1.5 py-0.5 rounded font-mono">ID: {wf.id}</span>
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono">v{wf.version}</span>
                    </div>
                    
                    {/* Steps chain */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {wf.steps.map((step, idx) => (
                        <React.Fragment key={step.id}>
                          <div className="bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-[10px] font-mono text-slate-300 flex items-center gap-1">
                            <span className="text-slate-400 font-bold">{step.id}</span>
                            <span className="text-slate-500 text-[9px] uppercase">({step.type})</span>
                          </div>
                          {idx < wf.steps.length - 1 && (
                            <ChevronRight className="h-3 w-3 text-slate-600" />
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onTriggerManual(wf.projectId, wf.id)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-2.5 py-1.5 rounded font-semibold transition flex items-center gap-1"
                      title="Ejecutar workflow"
                    >
                      <Play className="h-3 w-3 fill-current" /> Run
                    </button>
                    <button
                      onClick={() => onEditWorkflow(wf)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded font-semibold border border-slate-700 transition"
                      title="Editar workflow"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => window.confirm(`¿Eliminar el workflow "${wf.name}"?`) && onDeleteWorkflow(wf.id)}
                      aria-label={`Eliminar workflow ${wf.name}`}
                      className="btn-base icon-btn bg-slate-800 hover:bg-rose-500/10 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/20 transition"
                      title="Eliminar workflow"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
