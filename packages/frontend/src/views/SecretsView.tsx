import React, { useEffect, useState } from 'react';
import { Key, Trash2, Plus, Eye, EyeOff, Lock, RefreshCw, Copy } from 'lucide-react';
import { Project } from '@opencode/shared';

interface SecretsViewProps {
  projects: Project[];
  onShowNotification: (message: string, type?: 'success' | 'error' | 'info') => void;
}

interface SafeDeleteButtonProps {
  onDelete: () => void;
  title?: string;
  className?: string;
  label?: string;
}

const SafeDeleteButton: React.FC<SafeDeleteButtonProps> = ({
  onDelete,
  title,
  className = '',
  label
}) => {
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!isConfirming) return;
    const timer = setTimeout(() => {
      setIsConfirming(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [isConfirming]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isConfirming) {
      setIsConfirming(false);
      onDelete();
    } else {
      setIsConfirming(true);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`transition-all duration-300 ease-out flex items-center justify-center gap-1.5 rounded-lg border font-semibold select-none ${
        isConfirming
          ? 'bg-rose-600 border-rose-500 text-white px-2 py-1 text-xs scale-105 shadow-lg shadow-rose-900/40 animate-pulse'
          : className || 'text-slate-500 hover:text-rose-500 p-1 bg-slate-900 hover:bg-rose-500/10 border-slate-800'
      }`}
      title={isConfirming ? 'Haz clic de nuevo para confirmar' : title}
    >
      <Trash2 className={`transition-transform duration-300 ${isConfirming ? 'scale-110 rotate-12 h-3.5 w-3.5' : 'h-3.5 w-3.5'}`} />
      {label && !isConfirming && <span className="font-sans text-[11px] tracking-tight">{label}</span>}
      {isConfirming && <span className="font-sans text-[10px] tracking-tight">Confirmar?</span>}
    </button>
  );
};

export const SecretsView: React.FC<SecretsViewProps> = ({ projects, onShowNotification }) => {
  const [secretsMap, setSecretsMap] = useState<Record<string, { key: string; updatedAt: string }[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  // Form states per project
  const [newSecretKeys, setNewSecretKeys] = useState<Record<string, string>>({});
  const [newSecretValues, setNewSecretValues] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});

  const fetchSecretsForProject = async (projectId: string) => {
    setLoading(prev => ({ ...prev, [projectId]: true }));
    try {
      const res = await fetch(`/api/projects/${projectId}/secrets`);
      if (res.ok) {
        const data = await res.json();
        setSecretsMap(prev => ({ ...prev, [projectId]: data }));
      }
    } catch (err) {
      console.error(`Error fetching secrets for project ${projectId}:`, err);
    } finally {
      setLoading(prev => ({ ...prev, [projectId]: false }));
    }
  };

  useEffect(() => {
    projects.forEach(p => {
      fetchSecretsForProject(p.id);
    });
  }, [projects]);

  const handleAddSecret = async (projectId: string, e: React.FormEvent) => {
    e.preventDefault();
    const key = (newSecretKeys[projectId] || '').trim().toLowerCase();
    const value = newSecretValues[projectId] || '';
    if (!key || !value) {
      onShowNotification('Ambos campos son obligatorios.', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/projects/${projectId}/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value })
      });
      if (res.ok) {
        onShowNotification(`Secreto "${key}" configurado con éxito.`, 'success');
        setNewSecretKeys(prev => ({ ...prev, [projectId]: '' }));
        setNewSecretValues(prev => ({ ...prev, [projectId]: '' }));
        fetchSecretsForProject(projectId);
      } else {
        const err = await res.json();
        onShowNotification(err.error || 'Error al guardar el secreto.', 'error');
      }
    } catch (err: any) {
      onShowNotification(err.message || 'Error de red al guardar el secreto.', 'error');
    }
  };

  const handleDeleteSecret = async (projectId: string, key: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/secrets/${encodeURIComponent(key)}`, {
        method: 'DELETE'
      });
      if (res.status === 204 || res.ok) {
        onShowNotification(`Secreto "${key}" eliminado.`, 'success');
        fetchSecretsForProject(projectId);
      } else {
        onShowNotification('Error al eliminar el secreto.', 'error');
      }
    } catch (err: any) {
      onShowNotification(err.message || 'Error al eliminar el secreto.', 'error');
    }
  };

  const handleCopySecretReference = async (key: string) => {
    const reference = `{{secrets.${key}}}`;
    try {
      await navigator.clipboard.writeText(reference);
      onShowNotification('Referencia copiada.', 'success');
    } catch {
      onShowNotification('No se pudo copiar la referencia.', 'error');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center pb-4 border-b border-slate-800">
        <div>
          <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Key className="h-5 w-5 text-emerald-450" /> Bóveda de Secretos
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Gestiona de forma segura los tokens de API, llaves privadas y credenciales encriptados con AES-256-GCM.
          </p>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center flex flex-col items-center">
          <Lock className="h-12 w-12 mb-3 opacity-20 text-slate-400" />
          <p className="text-base font-semibold text-slate-200">No hay proyectos registrados</p>
          <p className="text-sm text-slate-500 mt-1">Registra un proyecto en la pestaña "Projects" para poder configurar sus secretos.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {projects.map(project => {
            const projectSecrets = secretsMap[project.id] || [];
            const isProjectLoading = loading[project.id];

            return (
              <div key={project.id} className="bg-slate-900 border border-slate-850 p-6 rounded-xl relative shadow-md flex flex-col md:flex-row gap-6">
                {/* Left Panel: List of configured secrets */}
                <div className="flex-1 space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="text-base font-bold text-slate-100 flex items-center gap-2">
                        {project.name}
                        <span className="text-xs text-slate-500 font-mono bg-slate-955 px-2 py-0.5 rounded">ID: {project.id}</span>
                      </h4>
                      <p className="text-xs text-slate-505 font-mono mt-1">{project.localPath}</p>
                    </div>
                     <button 
                       type="button"
                       onClick={() => fetchSecretsForProject(project.id)}
                       className="p-1.5 text-slate-500 hover:text-slate-200 transition"
                       title="Refrescar secretos"
                       aria-label={`Refrescar secretos de ${project.name}`}
                    >
                      <RefreshCw className={`h-4 w-4 ${isProjectLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  <div className="bg-slate-955 border border-slate-800 rounded-lg p-4 min-h-[120px] flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block mb-3">Secretos Guardados</span>
                      {projectSecrets.length === 0 ? (
                        <p className="text-xs text-slate-500 italic mt-2">No se han configurado secretos aún.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {projectSecrets.map(sec => (
                            <div key={sec.key} className="bg-slate-900 border border-slate-800 px-3 py-2 rounded-lg flex items-center justify-between gap-2 shadow-sm">
                              <div className="min-w-0">
                                <span className="font-mono text-xs font-semibold text-slate-200 block truncate" title={sec.key}>
                                  {sec.key}
                                </span>
                                <span className="text-[9px] text-slate-500 block mt-0.5">
                                  Act: {new Date(sec.updatedAt).toLocaleDateString()}
                                </span>
                              </div>
                               <div className="flex items-center gap-1 shrink-0">
                                 <button
                                   type="button"
                                   onClick={() => handleCopySecretReference(sec.key)}
                                   className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition border border-transparent hover:border-emerald-500/20"
                                   title="Copiar referencia para usar en un workflow"
                                   aria-label={`Copiar referencia del secreto ${sec.key}`}
                                 >
                                   <Copy className="h-3.5 w-3.5" />
                                 </button>
                                 <SafeDeleteButton
                                 onDelete={() => handleDeleteSecret(project.id, sec.key)}
                                 className="p-1 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded transition border border-transparent hover:border-rose-500/20"
                                 title="Eliminar Secreto"
                                 />
                               </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Panel: Add new secret Form */}
                <div className="w-full md:w-80 shrink-0 border-t md:border-t-0 md:border-l border-slate-800 pt-6 md:pt-0 md:pl-6 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block mb-3">Agregar Secreto</span>
                    <form onSubmit={(e) => handleAddSecret(project.id, e)} className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 mb-1">Clave (Key)</label>
                        <input
                          type="text"
                          placeholder="p. ej. github_token"
                          value={newSecretKeys[project.id] || ''}
                          onChange={e => setNewSecretKeys(prev => ({ ...prev, [project.id]: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                          className="w-full bg-slate-955 border border-slate-800 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 mb-1">Valor (Value)</label>
                        <div className="relative">
                          <input
                            type={showValues[project.id] ? 'text' : 'password'}
                            placeholder="Valor / API Token"
                            value={newSecretValues[project.id] || ''}
                            onChange={e => setNewSecretValues(prev => ({ ...prev, [project.id]: e.target.value }))}
                            className="w-full bg-slate-955 border border-slate-800 rounded p-2 pr-9 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                            required
                          />
                           <button
                             type="button"
                             onClick={() => setShowValues(prev => ({ ...prev, [project.id]: !prev[project.id] }))}
                             className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-200 transition"
                             aria-label={showValues[project.id] ? 'Ocultar valor del secreto' : 'Mostrar valor del secreto'}
                          >
                            {showValues[project.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                      <button
                        type="submit"
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-4 py-2 rounded font-semibold border border-emerald-500/30 transition flex items-center justify-center gap-1.5"
                      >
                        <Plus className="h-3.5 w-3.5" /> Guardar Secreto
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
