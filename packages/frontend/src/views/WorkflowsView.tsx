import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Bot,
  Boxes,
  Braces,
  CheckCircle,
  Clock,
  Code,
  Copy,
  Eye,
  EyeOff,
  HelpCircle,
  FileOutput,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Globe,
  Info,
  List,
  Loader2,
  Network,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Sliders,
  Sparkles,
  Split,
  Terminal,
  Timer,
  Trash2,
  UserCheck,
  Wand2,
  Zap,
  MessageSquare,
  FileSpreadsheet,
  Braces as JsonParserIcon
} from 'lucide-react';
import { PROVIDER_MODELS, Project, ProviderId, StepType, Workflow, WorkflowStep, validateWorkflow } from '@opencode/shared';
import type { WorkflowDiagnostic } from '@opencode/shared';
import { PrecedingStepInspectorView } from '../components/PrecedingStepInspectorView';
import { TemplateField } from '../components/TemplateField';
import { WebhookSchemaEditor } from '../components/WebhookSchemaEditor';
import { FlowGraph } from '../components/FlowGraph';
import { StepCatalogModal } from '../components/StepCatalogModal';
import { CRON_PRESETS, DEFAULT_STEP_CONFIGS, EMPTY_NEW_WORKFLOW, TIMEZONE_OPTIONS, START_TEMPLATES } from '../lib/constants';
import { parseCronToSimple, validateCronExpression } from '../lib/helpers';

interface SafeDeleteButtonProps {
  onDelete: () => void;
  title?: string;
  className?: string;
  label?: string;
}

export const SafeDeleteButton: React.FC<SafeDeleteButtonProps> = ({
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
          : className || 'text-slate-500 hover:text-rose-500 p-1.5 bg-slate-900 hover:bg-rose-500/10 border-slate-800'
      }`}
      title={isConfirming ? 'Haz clic de nuevo para confirmar' : title}
    >
      <Trash2 className={`transition-transform duration-300 ${isConfirming ? 'scale-110 rotate-12 h-3.5 w-3.5' : 'h-3.5 w-3.5'}`} />
      {label && !isConfirming && <span className="font-sans text-[11px] tracking-tight">{label}</span>}
      {isConfirming && <span className="font-sans text-[10px] tracking-tight">Confirmar?</span>}
    </button>
  );
};

const FieldLabel: React.FC<{ children: React.ReactNode; hint: string; required?: boolean }> = ({ children, hint, required }) => (
  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
    <span>{children}{required && <span className="text-rose-400 ml-1">*</span>}</span>
    <span title={hint} aria-label={`Ayuda: ${hint}`} className="inline-flex cursor-help text-slate-500 hover:text-emerald-400">
      <HelpCircle className="h-3.5 w-3.5" />
    </span>
  </label>
);

const ConfigHint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">{children}</p>
);

export interface WorkflowsViewProps {
  projects: Project[];
  workflowSteps: WorkflowStep[];
  setWorkflowSteps: React.Dispatch<React.SetStateAction<WorkflowStep[]>>;
  newWorkflow: Omit<Workflow, 'steps' | 'createdAt' | 'updatedAt'>;
  setNewWorkflow: React.Dispatch<React.SetStateAction<Omit<Workflow, 'steps' | 'createdAt' | 'updatedAt'>>>;
  isEditingWorkflow: boolean;
  setIsEditingWorkflow: React.Dispatch<React.SetStateAction<boolean>>;
  selectedStepId: string | null;
  setSelectedStepId: React.Dispatch<React.SetStateAction<string | null>>;
  isSavingWorkflow: boolean;
  setIsSavingWorkflow: React.Dispatch<React.SetStateAction<boolean>>;
  generatedTokens: Record<string, string>;
  setGeneratedTokens: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  showTokenMap: Record<string, boolean>;
  setShowTokenMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onFetchData: () => void;
  onShowNotification: (message: string, type?: 'success' | 'error' | 'info') => void;
};

// WORKFLOWS TAB — the visual step palette, pipeline node list, inspector panel
// for each step type, the workflow list and the template / run-payload modals.
export const WorkflowsView: React.FC<WorkflowsViewProps> = ({
  projects,
  workflowSteps,
  setWorkflowSteps,
  newWorkflow,
  setNewWorkflow,
  isEditingWorkflow,
  setIsEditingWorkflow,
  selectedStepId,
  setSelectedStepId,
  isSavingWorkflow,
  setIsSavingWorkflow,
  generatedTokens,
  setGeneratedTokens,
  showTokenMap,
  setShowTokenMap,
  onFetchData,
  onShowNotification
}) => {
  // Template & run-payload modals (only reachable from this tab).
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateWorkflowId, setTemplateWorkflowId] = useState<string | null>(null);
  const [canvasView, setCanvasView] = useState<'list' | 'graph'>('list');
  const [inspectorTab, setInspectorTab] = useState<'config' | 'routing' | 'inputs'>('config');

  // Step Catalog Modal state
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [insertBetweenContext, setInsertBetweenContext] = useState<{
    fromId: string;
    toId: string;
    label: 'T' | 'F' | null;
  } | null>(null);

  // Local state for builder
  const [databases, setDatabases] = useState<any[]>([]);
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<WorkflowDiagnostic[]>([]);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [nodeValidation, setNodeValidation] = useState<{ stepId: string; message: string; valid: boolean } | null>(null);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = 'Hay cambios sin guardar en el workflow.';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  React.useEffect(() => {
    fetch('/api/databases')
      .then(res => res.ok ? res.json() : [])
      .then(data => setDatabases(data))
      .catch(err => console.error('Error fetching databases in builder:', err));
  }, []);

  const handleUpdateStepConfig = (stepId: string, updatedConfig: Record<string, any>) => {
    setNodeValidation(null);
    setIsDirty(true);
    setWorkflowSteps(prev =>
      prev.map(step =>
        step.id === stepId
          ? { ...step, config: { ...step.config, ...updatedConfig } }
          : step
      )
    );
  };

  const handleValidateNode = (step: WorkflowStep) => {
    const config = step.config || {};
    const errors: string[] = [];
    if (step.type === 'code' || step.type === 'python') {
      const language = step.type === 'python' ? 'python' : (config.language || 'javascript');
      const source = config.source || 'inline';
      if (source === 'inline' && !String(config.code || '').trim()) errors.push(`El código ${language} inline está vacío.`);
      if (source === 'file' && (!String(config.filePath || '').trim() || String(config.filePath).includes('..') || /^(?:[A-Za-z]:[\\/]|[\\/])/.test(String(config.filePath).trim()))) errors.push('La ruta debe ser relativa y no contener ..');
      if (language === 'python') {
        try { const args = config.args ? (typeof config.args === 'string' ? JSON.parse(config.args) : config.args) : []; if (!Array.isArray(args)) throw new Error(); } catch { errors.push('Los argumentos deben ser un array JSON, por ejemplo ["--mode", "fast"].'); }
        const timeout = Number(config.timeoutMs ?? 30000); if (!Number.isFinite(timeout) || timeout < 1 || timeout > 300000) errors.push('El timeout debe estar entre 1 y 300000 ms.');
      }
    } else if (step.type === 'http_request') {
      try { const url = new URL(String(config.url || '')); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); } catch { errors.push('La URL debe ser http:// o https://.'); }
      try { const headers = typeof config.headers === 'string' ? JSON.parse(config.headers) : (config.headers || {}); if (!headers || Array.isArray(headers) || typeof headers !== 'object') throw new Error(); } catch { errors.push('Headers debe ser un objeto JSON válido.'); }
      if (config.authType === 'bearer' && !String(config.bearerToken || '').trim()) errors.push('Falta el Bearer token.');
    } else if (step.type === 'discord_notify') {
      if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(String(config.webhookUrl || ''))) errors.push('La URL debe ser un webhook HTTPS de Discord.');
      if (!String(config.message || config.content || '').trim()) errors.push('El mensaje no puede estar vacío.');
      if (String(config.message || config.content || '').length > 2000) errors.push('Discord permite hasta 2000 caracteres por mensaje.');
    }
    setNodeValidation({ stepId: step.id, valid: errors.length === 0, message: errors[0] || 'Configuración válida. No se ejecutó ningún código ni request externo.' });
  };

  const handleAgentProviderChange = (stepId: string, provider: string) => {
    const currentStep = workflowSteps.find(s => s.id === stepId);
    const currentModel = currentStep?.config?.model;
    const models = PROVIDER_MODELS[provider as ProviderId] || [];
    // If the current model isn't in the new provider's catalog, reset it to the
    // first available model (or empty for custom).
    const resetModel = provider === 'custom'
      ? ''
      : (models.includes(currentModel) ? currentModel : (models[0] || ''));
    handleUpdateStepConfig(stepId, { provider, model: resetModel });
  };

  const updateSimpleCronConfig = (stepId: string, updates: Record<string, any>) => {
    const currentStep = workflowSteps.find(s => s.id === stepId);
    if (!currentStep) return;
    const currentConfig = currentStep.config || {};

    const parsed = parseCronToSimple(currentConfig.cronExpression || '0 9 * * 1-5');
    const merged = {
      cronFrequency: currentConfig.cronFrequency || parsed.frequency,
      cronHour: currentConfig.cronHour !== undefined ? currentConfig.cronHour : parsed.hour,
      cronMinute: currentConfig.cronMinute !== undefined ? currentConfig.cronMinute : parsed.minute,
      cronDaysOfWeek: currentConfig.cronDaysOfWeek || parsed.daysOfWeek,
      cronDayOfMonth: currentConfig.cronDayOfMonth || parsed.dayOfMonth,
      ...updates
    };

    let newExpr = '0 9 * * 1-5';
    if (merged.cronFrequency === 'hourly') {
      newExpr = '0 * * * *';
    } else if (merged.cronFrequency === 'daily') {
      newExpr = `${merged.cronMinute} ${merged.cronHour} * * *`;
    } else if (merged.cronFrequency === 'weekly') {
      const days = merged.cronDaysOfWeek.length > 0 ? merged.cronDaysOfWeek.join(',') : '*';
      newExpr = `${merged.cronMinute} ${merged.cronHour} * * ${days}`;
    } else if (merged.cronFrequency === 'monthly') {
      newExpr = `${merged.cronMinute} ${merged.cronHour} ${merged.cronDayOfMonth} * *`;
    }

    handleUpdateStepConfig(stepId, {
      ...merged,
      cronExpression: newExpr
    });
  };

  const handleUpdateStep = (stepId: string, updatedFields: Partial<WorkflowStep>) => {
    setIsDirty(true);
    setWorkflowSteps(prev =>
      prev.map(step =>
        step.id === stepId
          ? { ...step, ...updatedFields }
          : step
      )
    );
  };

  const handleDeleteStep = (stepId: string) => {
    setIsDirty(true);
    setWorkflowSteps(prev => {
      const filtered = prev.filter(s => s.id !== stepId);
      return filtered.map(step => ({
        ...step,
        nextStepIds: step.nextStepIds.filter(id => id !== stepId)
      }));
    });
    if (selectedStepId === stepId) {
      setSelectedStepId(null);
    }
  };

  const handleCancelEditWorkflow = () => {
    if (isDirty && !window.confirm('Hay cambios sin guardar. ¿Querés descartarlos?')) return;
    setIsEditingWorkflow(false);
    setNewWorkflow(EMPTY_NEW_WORKFLOW);
    setWorkflowSteps([]);
    setSelectedStepId(null);
    setGeneratedTokens({});
    setIsDirty(false);
    setValidationWarnings([]);
  };

  const slugify = (text: string) => {
    return text.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
  };

  const handleWorkflowNameChange = (name: string) => {
    setIsDirty(true);
    if (!isEditingWorkflow) {
      const slug = slugify(name);
      setNewWorkflow(prev => ({
        ...prev,
        name,
        id: prev.id === '' || prev.id === slugify(prev.name) ? slug : prev.id
      }));
    } else {
      setNewWorkflow(prev => ({ ...prev, name }));
    }
  };

  const handleCreateWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationErrors([]);
    setValidationWarnings([]);

    let finalId = newWorkflow.id.trim();
    if (!finalId) {
      finalId = slugify(newWorkflow.name);
    }

    const errors: string[] = [];
    if (!newWorkflow.name.trim()) {
      errors.push('El nombre del workflow es obligatorio.');
    }
    if (!newWorkflow.projectId) {
      errors.push('Debe asociar el workflow a un proyecto.');
    }
    if (workflowSteps.length === 0) {
      errors.push('El workflow debe contener al menos un paso.');
    }

    const isRelativeProjectFile = (value: unknown) => typeof value === 'string' && value.trim() !== '' && !value.includes('..') && !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value.trim());
    const parseStringArgs = (value: unknown): string[] | null => {
      if (value === undefined || value === '') return [];
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(parsed) && parsed.every(arg => typeof arg === 'string' || typeof arg === 'number') ? parsed.map(String) : null;
      } catch {
        return null;
      }
    };

    // Check nodes configuration
    workflowSteps.forEach(step => {
      const stepLabel = step.config?.name || step.id;
      if (step.type === 'shell_test' && !step.config?.command?.trim()) {
        errors.push(`Paso "${stepLabel}": El comando de shell está vacío.`);
      }
      if (step.type === 'agent' && !step.config?.prompt?.trim()) {
        errors.push(`Paso "${stepLabel}": El prompt del agente está vacío.`);
      }
      if (step.type === 'python') {
        const source = step.config?.source || 'inline';
        if (source === 'inline' && !step.config?.code?.trim()) errors.push(`Paso "${stepLabel}": El código Python inline es obligatorio.`);
        if (source === 'file' && !isRelativeProjectFile(step.config?.filePath)) errors.push(`Paso "${stepLabel}": La ruta Python debe ser relativa y apuntar a un archivo del proyecto.`);
        if (parseStringArgs(step.config?.args) === null) errors.push(`Paso "${stepLabel}": Los argumentos Python deben ser un array JSON de strings o números.`);
        const timeout = Number(step.config?.timeoutMs ?? 30000);
        if (!Number.isFinite(timeout) || timeout < 1 || timeout > 300000) errors.push(`Paso "${stepLabel}": El timeout Python debe estar entre 1 y 300000 ms.`);
      }
      if (step.type === 'code') {
        const language = step.config?.language || 'javascript';
        if (!['javascript', 'python'].includes(language)) errors.push(`Paso "${stepLabel}": El lenguaje del nodo Code no es válido.`);
        if (!step.config?.code?.trim() && (language === 'javascript' || step.config?.source !== 'file')) errors.push(`Paso "${stepLabel}": El código es obligatorio para un nodo Code inline.`);
        if (language === 'python' && step.config?.source === 'file' && !isRelativeProjectFile(step.config?.filePath)) errors.push(`Paso "${stepLabel}": La ruta Python debe ser relativa y apuntar a un archivo del proyecto.`);
        if (language === 'python' && parseStringArgs(step.config?.args) === null) errors.push(`Paso "${stepLabel}": Los argumentos Python del nodo Code deben ser un array JSON de strings o números.`);
      }
      if (step.type === 'json_parser') {
        if (!step.config?.inputExpr?.trim()) errors.push(`Paso "${stepLabel}": La expresión de entrada del JSON Parser es obligatoria.`);
        try {
          const mapping = typeof step.config?.mapping === 'string' ? JSON.parse(step.config.mapping) : step.config?.mapping;
          if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object') throw new Error();
        } catch {
          errors.push(`Paso "${stepLabel}": El mapping del JSON Parser debe ser un objeto JSON válido.`);
        }
      }
      if (step.type === 'http_request') {
        try {
          const url = new URL(step.config?.url || '');
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
        } catch {
          errors.push(`Paso "${stepLabel}": La URL HTTP debe ser válida y usar http o https.`);
        }
        if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(step.config?.method || '')) errors.push(`Paso "${stepLabel}": El método HTTP no es válido.`);
        if (!step.config?.headers || Array.isArray(step.config.headers) || typeof step.config.headers !== 'object') errors.push(`Paso "${stepLabel}": Las cabeceras HTTP deben ser un objeto JSON.`);
      }
      if (step.type === 'discord_notify') {
        if (!step.config?.webhookUrl?.trim()) errors.push(`Paso "${stepLabel}": El webhook de Discord es obligatorio.`);
        else if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(step.config.webhookUrl)) errors.push(`Paso "${stepLabel}": La URL no parece ser un webhook válido de Discord.`);
        if (!step.config?.message?.trim() && !step.config?.content?.trim()) errors.push(`Paso "${stepLabel}": El mensaje de Discord está vacío.`);
      }
      if (step.type === 'nosql') {
        if (!step.config?.databaseId) {
          errors.push(`Paso "${stepLabel}": La base de datos es obligatoria.`);
        }
        if (!step.config?.collection) {
          errors.push(`Paso "${stepLabel}": La colección es obligatoria.`);
        }
        if (!step.config?.operation) {
          errors.push(`Paso "${stepLabel}": La operación es obligatoria.`);
        }
        if (!step.config?.documentId?.trim()) {
          errors.push(`Paso "${stepLabel}": El ID del documento es obligatorio.`);
        }
        if (['insert', 'update'].includes(step.config?.operation || '') && (!step.config?.data || (typeof step.config?.data === 'string' && !step.config?.data.trim()))) {
          errors.push(`Paso "${stepLabel}": Los datos JSON son obligatorios para operaciones de inserción/actualización.`);
        }
      }
    });

    if (errors.length > 0) {
      setValidationErrors(errors);
      setIsErrorModalOpen(true);
      return;
    }

    const workflow: Workflow = {
      id: finalId,
      name: newWorkflow.name,
      projectId: newWorkflow.projectId,
      version: newWorkflow.version || 1,
      isActive: newWorkflow.isActive,
      steps: workflowSteps,
      createdAt: '',
      updatedAt: ''
    };
    const structuralValidation = validateWorkflow(workflow);
    setValidationWarnings(structuralValidation.warnings);
    if (structuralValidation.errors.length > 0) {
      setValidationErrors(structuralValidation.errors.map(diagnostic => diagnostic.stepId ? `Paso "${diagnostic.stepId}": ${diagnostic.message}` : diagnostic.message));
      setIsErrorModalOpen(true);
      return;
    }

    setIsSavingWorkflow(true);

    const url = isEditingWorkflow ? `/api/workflows/${workflow.id}` : '/api/workflows';
    const method = isEditingWorkflow ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow)
      });
      const resData = await res.json();

      if (!res.ok) {
        const serverErrors = resData.validation?.errors?.map((diagnostic: WorkflowDiagnostic) => diagnostic.stepId ? `Paso "${diagnostic.stepId}": ${diagnostic.message}` : diagnostic.message) || [];
        setValidationErrors(serverErrors.length > 0 ? serverErrors : [resData.error || 'Error al guardar el workflow en el servidor.']);
        setValidationWarnings(resData.validation?.warnings || []);
        setIsErrorModalOpen(true);
        return;
      }

      if (resData.newWebhookTokens) {
        setGeneratedTokens(prev => ({ ...prev, ...resData.newWebhookTokens }));
      }
      setValidationWarnings(resData.validation?.warnings || structuralValidation.warnings);

      onShowNotification(isEditingWorkflow ? 'Workflow actualizado con éxito!' : 'Workflow creado con éxito!', 'success');
      setIsDirty(false);

      setNewWorkflow(EMPTY_NEW_WORKFLOW);
      setWorkflowSteps([]);
      setSelectedStepId(null);
      if (isEditingWorkflow) {
        setIsEditingWorkflow(false);
      }
      onFetchData();
    } catch (err: any) {
      console.error('Failed to save workflow:', err);
      setValidationErrors([err.message || 'Error de red al guardar el workflow.']);
      setIsErrorModalOpen(true);
    } finally {
      setIsSavingWorkflow(false);
    }
  };

  const handleSelectStepFromCatalog = (type: StepType, configOverrides?: Record<string, any>) => {
    setIsDirty(true);
    const existingCount = workflowSteps.filter(s => s.type === type).length;
    let index = existingCount + 1;
    let stepId = `${type}_${index}`;
    while (workflowSteps.some(s => s.id === stepId)) {
      index++;
      stepId = `${type}_${index}`;
    }
    const newStep: WorkflowStep = {
      id: stepId,
      type,
      config: { ...DEFAULT_STEP_CONFIGS[type], ...configOverrides },
      nextStepIds: []
    };

    if (insertBetweenContext) {
      const { fromId, toId, label } = insertBetweenContext;
      // Splicing/Inserting C between A and B
      setWorkflowSteps(prev => {
        return prev.map(s => {
          if (s.id === fromId) {
            // A points to C
            if (s.type === 'condition') {
              const updatedConfig = { ...s.config };
              if (label === 'T') {
                updatedConfig.onTrue = newStep.id;
              } else if (label === 'F') {
                updatedConfig.onFalse = newStep.id;
              }
              return {
                ...s,
                config: updatedConfig,
                nextStepIds: s.nextStepIds.map(nid => nid === toId ? newStep.id : nid)
              };
            } else {
              return {
                ...s,
                nextStepIds: s.nextStepIds.map(nid => nid === toId ? newStep.id : nid)
              };
            }
          }
          return s;
        });
      });
      // C points to B
      newStep.nextStepIds = [toId];
      setWorkflowSteps(prev => [...prev, newStep]);
      setInsertBetweenContext(null);
    } else {
      // Normal append
      setWorkflowSteps(prev => {
        if (prev.length > 0) {
          const updated = [...prev];
          const lastStep = updated[updated.length - 1];
          if (lastStep.nextStepIds.length === 0 && lastStep.type !== 'condition') {
            updated[updated.length - 1] = {
              ...lastStep,
              nextStepIds: [newStep.id]
            };
          }
          return [...updated, newStep];
        }
        return [newStep];
      });
    }

    setSelectedStepId(newStep.id);
    setIsCatalogModalOpen(false);
  };

  const handleDeleteStepDirect = (stepId: string) => {
    setIsDirty(true);
    const stepToDelete = workflowSteps.find(s => s.id === stepId);
    if (!stepToDelete) return;
    const nextSteps = stepToDelete.nextStepIds;

    setWorkflowSteps(prev => {
      const filtered = prev.filter(s => s.id !== stepId);
      return filtered.map(s => {
        let isUpdated = false;
        let nextIds = [...s.nextStepIds];
        
        if (s.nextStepIds.includes(stepId)) {
          nextIds = nextIds.filter(id => id !== stepId);
          for (const ns of nextSteps) {
            if (!nextIds.includes(ns)) {
              nextIds.push(ns);
            }
          }
          isUpdated = true;
        }

        let updatedConfig = s.config ? { ...s.config } : {};
        if (s.type === 'condition') {
          if (s.config?.onTrue === stepId) {
            updatedConfig.onTrue = nextSteps[0] || '';
            isUpdated = true;
          }
          if (s.config?.onFalse === stepId) {
            updatedConfig.onFalse = nextSteps[1] || nextSteps[0] || '';
            isUpdated = true;
          }
        }

        return isUpdated ? { ...s, nextStepIds: nextIds, config: updatedConfig } : s;
      });
    });

    if (selectedStepId === stepId) {
      setSelectedStepId(null);
    }
  };

  const getStepConfigurationState = (step: WorkflowStep): 'listo' | 'requiere configuración' | 'revisar' => {
    const config = step.config || {};
    if (step.type === 'agent' && !String(config.prompt || '').trim()) return 'requiere configuración';
    if (step.type === 'shell_test' && !String(config.command || '').trim()) return 'requiere configuración';
    if (step.type === 'http_request' && !String(config.url || '').trim()) return 'requiere configuración';
    if (step.type === 'discord_notify' && !String(config.webhookUrl || '').trim()) return 'requiere configuración';
    if (step.type === 'nosql' && (!config.databaseId || !String(config.collection || '').trim())) return 'requiere configuración';
    if (step.type === 'condition' && (!String(config.expression || '').trim() || !config.onTrue || !config.onFalse)) return 'revisar';
    if (step.type === 'trigger' && !config.triggerType) return 'requiere configuración';
    return 'listo';
  };

  const getWorkflowConfigurationSummary = () => {
    const states = workflowSteps.map(getStepConfigurationState);
    return {
      ready: states.filter(state => state === 'listo').length,
      needsConfig: states.filter(state => state === 'requiere configuración').length,
      review: states.filter(state => state === 'revisar').length
    };
  };

  const buildTemplateSteps = (templateId: string): WorkflowStep[] => {
    const mk = (type: StepType, id: string, config: Record<string, any>, nextStepIds: string[] = []): WorkflowStep => ({
      id,
      type,
      config,
      nextStepIds
    });

    if (templateId === 'webhook-process-approve-save') {
      const trigger = mk('trigger', 'trigger', { triggerType: 'webhook', name: 'Recibir webhook', cronExpression: '', timezone: 'America/Bogota' }, ['process']);
      const shell = mk('shell_test', 'process', { command: 'echo "Procesado {{context.triggerPayload.message}}"', name: 'Procesar mensaje' }, ['approve']);
      const approval = mk('approval', 'approve', { description: '¿Aprobás el resultado? Mensaje: {{context.triggerPayload.message}}', name: 'Verificación humana' }, ['save']);
      const output = mk('output', 'save', { outputType: 'file', filePath: 'resultado.txt', data: 'Resultado: {{context.triggerPayload.message}}', name: 'Guardar resultado' });
      return [trigger, shell, approval, output];
    }

    if (templateId === 'manual-http-save') {
      const trigger = mk('trigger', 'trigger', { triggerType: 'manual', name: 'Inicio manual' }, ['http']);
      const http = mk('output', 'http', { outputType: 'http', method: 'POST', url: 'https://api.example.com/webhook', body: '{"message": "{{context.triggerPayload.message}}"}', name: 'Llamada HTTP' }, ['save']);
      const save = mk('output', 'save', { outputType: 'file', filePath: 'resultado.txt', data: 'Resultado: {{context.triggerPayload.message}}', name: 'Guardar resultado' });
      return [trigger, http, save];
    }

    if (templateId === 'github-issue-fix-pr') {
      const trigger = mk('trigger', 'trigger', { triggerType: 'webhook', name: 'GitHub Issue Webhook' }, ['analyze_agent']);
      const agent = mk('agent', 'analyze_agent', {
        prompt: 'Analizá el issue "{{context.triggerPayload.issue.title}}" con la descripción:\n{{context.triggerPayload.issue.body}}.\nEscribí una solución limpia en el repositorio local.',
        agent: 'engineer',
        provider: 'google',
        model: 'gemini-3-flash-preview',
        name: 'Agente AI: Resolver Issue'
      }, ['human_approve']);
      const approval = mk('approval', 'human_approve', {
        description: 'Por favor revisá el fix generado por el Agente de IA para el issue "{{context.triggerPayload.issue.title}}" antes de confirmarlo en Git.',
        name: 'Revisión Humana'
      }, ['git_commit']);
      const git = mk('git', 'git_commit', {
        commitMessage: 'fix: resolver automáticamente issue #{{context.triggerPayload.issue.number}}',
        name: 'Commit de Cambios'
      }, ['create_pr']);
      const pr = mk('pr', 'create_pr', {
        title: 'fix: resolución automática del issue #{{context.triggerPayload.issue.number}}',
        body: 'Pull Request generado automáticamente por OpenCode Orchestrator.\n\nCloses #{{context.triggerPayload.issue.number}}.',
        baseBranch: 'main',
        name: 'Crear Pull Request'
      });
      return [trigger, agent, approval, git, pr];
    }

    if (templateId === 'api-scraping-db-save') {
      const trigger = mk('trigger', 'trigger', {
        triggerType: 'cron',
        cronExpression: '0 8 * * *',
        timezone: 'America/Bogota',
        name: 'Cron Diario (8:00 AM)'
      }, ['fetch_external_api']);
      const http = mk('http_request', 'fetch_external_api', {
        url: 'https://api.github.com/repos/google/gemini-cookbook/releases/latest',
        method: 'GET',
        headers: { 'User-Agent': 'OpenCode-Orchestrator' },
        name: 'Consultar API Externa'
      }, ['process_data']);
      const code = mk('code', 'process_data', {
        language: 'javascript',
        code: `// Limpiamos y formateamos la respuesta de la API para guardarla\nconst release = context.stepOutputs.fetch_external_api.responseBody;\n\ncontext.variables.normalizedRelease = {\n  tag_name: release.tag_name,\n  name: release.name,\n  published_at: release.published_at,\n  author: release.author?.login,\n  url: release.html_url\n};\n\nreturn { success: true };`,
        name: 'Procesar con JS/Python'
      }, ['save_to_database']);
      const nosql = mk('nosql', 'save_to_database', {
        databaseId: 'opencode_db',
        collection: 'releases',
        operation: 'insert',
        data: '{{context.variables.normalizedRelease}}',
        name: 'Guardar en Base Datos'
      });
      return [trigger, http, code, nosql];
    }

    if (templateId === 'ci-cd-test-rollback') {
      const trigger = mk('trigger', 'trigger', { triggerType: 'webhook', name: 'Webhook Push Event' }, ['run_tests']);
      const tests = mk('shell_test', 'run_tests', {
        command: 'npm install && npm run build && npm test',
        name: 'Ejecutar Suite de Pruebas'
      }, ['check_result']);
      const condition = mk('condition', 'check_result', {
        expression: 'context.stepOutputs.run_tests.exitCode === 0',
        onTrue: 'deploy_prod',
        onFalse: 'rollback_script',
        name: '¿Pruebas Exitosas?'
      }, ['deploy_prod', 'rollback_script']);
      const deploy = mk('shell_test', 'deploy_prod', {
        command: 'echo "Deploying to production server..."',
        name: 'Desplegar a Producción'
      });
      const rollback = mk('shell_test', 'rollback_script', {
        command: 'echo "Tests failed! Rolling back changes..."',
        name: 'Rollback & Alertas'
      });
      return [trigger, tests, condition, deploy, rollback];
    }

    if (templateId === 'multi-agent-parallel-coding') {
      const trigger = mk('trigger', 'trigger', { triggerType: 'manual', name: 'Inicio Manual' }, ['split_agents']);
      const parallel = mk('parallel', 'split_agents', {
        branches: ['write_code_agent', 'write_test_agent'],
        name: 'Ejecución en Paralelo'
      }, ['write_code_agent', 'write_test_agent']);
      const agentCode = mk('agent', 'write_code_agent', {
        prompt: 'Escribí la función de ordenamiento bubbleSort en JavaScript.',
        agent: 'coder',
        provider: 'google',
        model: 'gemini-3-flash-preview',
        name: 'Agente AI: Escribir Código'
      }, ['merge_outputs']);
      const agentTest = mk('agent', 'write_test_agent', {
        prompt: 'Escribí 3 pruebas unitarias usando Jest para una función bubbleSort.',
        agent: 'tester',
        provider: 'google',
        model: 'gemini-3-flash-preview',
        name: 'Agente AI: Escribir Tests'
      }, ['merge_outputs']);
      const merge = mk('code', 'merge_outputs', {
        language: 'javascript',
        code: `// Unimos los resultados de ambos agentes en un reporte único\nconst code = context.stepOutputs.write_code_agent.output;\nconst tests = context.stepOutputs.write_test_agent.output;\n\ncontext.variables.unifiedReport = {\n  code,\n  tests,\n  mergedAt: new Date().toISOString()\n};\n\nreturn { success: true };`,
        name: 'Fusionar Resultados'
      }, ['approve_report']);
      const approval = mk('approval', 'approve_report', {
        description: 'Revisá el código y las pruebas generadas por los agentes en paralelo.',
        name: 'Verificación de Reporte'
      });
      return [trigger, parallel, agentCode, agentTest, merge, approval];
    }

    const trigger = mk('trigger', 'trigger', { triggerType: 'manual', name: 'Inicio manual' }, ['approve']);
    const approval = mk('approval', 'approve', { description: '¿Aprobás la ejecución?', name: 'Aprobación humana' }, ['process']);
    const shell = mk('shell_test', 'process', { command: 'echo "Ejecutando tras aprobación"', name: 'Proceso shell' });
    return [trigger, approval, shell];
  };

  const handleOpenTemplateModal = (workflowId?: string) => {
    setTemplateWorkflowId(workflowId || null);
    setShowTemplateModal(true);
  };

  const applyTemplate = (templateId: string) => {
    setIsDirty(true);
    const steps = buildTemplateSteps(templateId);
    const template = START_TEMPLATES.find(t => t.id === templateId);
    setWorkflowSteps(steps);
    setIsEditingWorkflow(false);
    setNewWorkflow(prev => ({
      ...prev,
      name: template ? template.name : prev.name
    }));
    setSelectedStepId(null);
    setShowTemplateModal(false);
    if (templateWorkflowId) {
      setNewWorkflow(prev => ({ ...prev, projectId: templateWorkflowId }));
    }
    setPendingTemplateId(null);
  };

  const handleApplyTemplate = (templateId: string) => {
    if (workflowSteps.length > 0 || isDirty) {
      setPendingTemplateId(templateId);
      return;
    }
    applyTemplate(templateId);
  };

  const handleCreateEmptyWorkflow = () => {
    setIsDirty(true);
    setWorkflowSteps([]);
    setIsEditingWorkflow(false);
    setNewWorkflow(EMPTY_NEW_WORKFLOW);
    setSelectedStepId(null);
    setShowTemplateModal(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const getStepStyle = (step: WorkflowStep) => {
    switch (step.type) {
      case 'trigger':
        return {
          icon: step.config?.triggerType === 'webhook' ? Zap : Clock,
          colorClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 border-l-4 border-l-emerald-500',
          label: 'Trigger (Webhook/Cron)'
        };
      case 'http_request':
        return {
          icon: Globe,
          colorClass: 'bg-sky-500/10 text-sky-400 border-sky-500/30 border-l-4 border-l-sky-500',
          label: 'HTTP Request'
        };
      case 'code':
        return {
          icon: Code,
          colorClass: 'bg-lime-500/10 text-lime-400 border-lime-500/30 border-l-4 border-l-lime-500',
          label: 'Code Script (JS/Python)'
        };
      case 'python':
        return {
          icon: Terminal,
          colorClass: 'bg-amber-500/10 text-amber-400 border-amber-500/30 border-l-4 border-l-amber-500',
          label: 'Python Script'
        };
      case 'json_parser':
        return {
          icon: JsonParserIcon,
          colorClass: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 border-l-4 border-l-cyan-500',
          label: 'JSON Parser'
        };
      case 'normalizer':
        return {
          icon: Braces,
          colorClass: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 border-l-4 border-l-cyan-500',
          label: 'Normalize Payload'
        };
      case 'agent':
        return {
          icon: Bot,
          colorClass: 'bg-purple-500/10 text-purple-400 border-purple-500/30 border-l-4 border-l-purple-500',
          label: 'OpenCode Agent'
        };
      case 'condition':
        return {
          icon: Split,
          colorClass: 'bg-amber-500/10 text-amber-400 border-amber-500/30 border-l-4 border-l-amber-500',
          label: 'Condition Logic'
        };
      case 'shell_test':
        return {
          icon: Terminal,
          colorClass: 'bg-slate-500/15 text-slate-300 border-slate-700 border-l-4 border-l-slate-400',
          label: 'Shell Command / Test'
        };
      case 'git':
        return {
          icon: GitCommit,
          colorClass: 'bg-blue-500/10 text-blue-400 border-blue-500/30 border-l-4 border-l-blue-500',
          label: 'Git Commit'
        };
      case 'pr':
        return {
          icon: GitPullRequest,
          colorClass: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30 border-l-4 border-l-indigo-500',
          label: 'GitHub Pull Request'
        };
      case 'transform':
        return {
          icon: Wand2,
          colorClass: 'bg-pink-500/10 text-pink-400 border-pink-500/30 border-l-4 border-l-pink-500',
          label: 'Format Template'
        };
      case 'output':
        return {
          icon: FileOutput,
          colorClass: 'bg-teal-500/10 text-teal-400 border-teal-500/30 border-l-4 border-l-teal-500',
          label: 'Local File Output'
        };
      case 'approval':
        return {
          icon: UserCheck,
          colorClass: 'bg-orange-500/10 text-orange-400 border-orange-500/30 border-l-4 border-l-orange-500',
          label: 'Human Approval Gate'
        };
      case 'parallel':
        return {
          icon: GitBranch,
          colorClass: 'bg-sky-500/10 text-sky-400 border-sky-500/30 border-l-4 border-l-sky-500',
          label: 'Parallel Branches'
        };
      case 'loop':
        return {
          icon: Repeat,
          colorClass: 'bg-violet-500/10 text-violet-400 border-violet-500/30 border-l-4 border-l-violet-500',
          label: 'Loop / Repeat'
        };
      case 'retry':
        return {
          icon: RotateCcw,
          colorClass: 'bg-rose-500/10 text-rose-400 border-rose-500/30 border-l-4 border-l-rose-500',
          label: 'Retry / Fallback'
        };
      case 'wait':
        return {
          icon: Timer,
          colorClass: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30 border-l-4 border-l-yellow-500',
          label: 'Wait / Delay'
        };
      case 'discord_notify':
        return {
          icon: MessageSquare,
          colorClass: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30 border-l-4 border-l-indigo-500',
          label: 'Discord Notification'
        };
      case 'google_sheets':
        return {
          icon: FileSpreadsheet,
          colorClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 border-l-4 border-l-emerald-500',
          label: 'Google Sheets Integration'
        };
      default:
        return {
          icon: Boxes,
          colorClass: 'bg-slate-500/10 text-slate-300 border-slate-800 border-l-4 border-l-slate-500',
          label: 'Step'
        };
    }
  };

  // 2. Helper to detect preceding workflow steps
  const getStepsBefore = (currentStepId: string): WorkflowStep[] => {
    const index = workflowSteps.findIndex(s => s.id === currentStepId);
    if (index <= 0) return [];
    return workflowSteps.slice(0, index);
  };

  return (
    <div className="space-y-8">
      {/* Build Workflow Graph */}
      <div className="bg-slate-900 border border-slate-850 rounded-xl overflow-hidden flex flex-col shadow-md">
        
        {/* Compact Workflow Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/40 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2 mb-1.5">
              <GitBranch className="h-4 w-4 text-emerald-450" />
               <span>{isEditingWorkflow ? 'Editar Workflow Graph' : 'Nuevo Workflow Graph'}</span>
               {isDirty && <span className="text-[10px] font-normal text-amber-400">Cambios sin guardar</span>}
            </h3>
            <div className="flex flex-wrap items-center gap-4">
              {/* Name Input */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-sans">Name:</span>
                <input
                  type="text"
                  placeholder="e.g. Diagnose & PR"
                  value={newWorkflow.name}
                  onChange={e => handleWorkflowNameChange(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 w-44 font-sans"
                  required
                />
              </div>
              
              {/* Project Select */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-sans">Proyecto:</span>
                <select
                  value={newWorkflow.projectId || ''}
                   onChange={e => { setIsDirty(true); setNewWorkflow({ ...newWorkflow, projectId: e.target.value }); }}
                  className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 w-44 font-sans"
                >
                  <option value="">-- Seleccionar --</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Active Toggle */}
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newWorkflow.isActive}
                   onChange={e => { setIsDirty(true); setNewWorkflow({ ...newWorkflow, isActive: e.target.checked }); }}
                  className="rounded bg-slate-950 border-slate-800 text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5"
                />
                <span className="text-xs text-slate-350">Activo</span>
              </label>

              {/* Advanced Toggle */}
              <button
                type="button"
                onClick={() => setShowAdvancedConfig(!showAdvancedConfig)}
                className="text-xs text-slate-450 hover:text-slate-350 underline font-sans"
              >
                {showAdvancedConfig ? 'Ocultar Avanzado' : 'Mostrar Avanzado'}
              </button>
            </div>
           </div>

            {(() => {
             const summary = getWorkflowConfigurationSummary();
             const workflowReady = Boolean(newWorkflow.name.trim() && newWorkflow.projectId && workflowSteps.length > 0 && summary.needsConfig === 0 && summary.review === 0);
             return (
               <div className="flex items-center gap-2 text-[10px] text-slate-500 bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2" title="Estado derivado de la configuración actual de cada paso">
                 <span className="font-semibold text-slate-400">Estado</span>
                 <span className={workflowReady ? 'text-emerald-400' : 'text-amber-400'}>{workflowReady ? 'workflow listo' : 'workflow incompleto'}</span>
                 <span className="text-emerald-400">{summary.ready} listos</span>
                 {summary.needsConfig > 0 && <span className="text-amber-400">{summary.needsConfig} por configurar</span>}
                 {summary.review > 0 && <span className="text-rose-400">{summary.review} por revisar</span>}
               </div>
             );
            })()}
            {validationWarnings.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-300" role="status">
                <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> {validationWarnings.length} advertencia{validationWarnings.length === 1 ? '' : 's'} estructural{validationWarnings.length === 1 ? '' : 'es'}</div>
                <ul className="mt-1 space-y-0.5 text-amber-200/80">
                  {validationWarnings.map((warning, index) => <li key={`${warning.stepId || 'workflow'}-${index}`}>{warning.stepId ? `Paso "${warning.stepId}": ` : ''}{warning.message}</li>)}
                </ul>
              </div>
            )}
           
           {/* Action buttons */}
          <div className="flex gap-2 shrink-0">
            {isEditingWorkflow && (
              <button
                type="button"
                onClick={handleCancelEditWorkflow}
                className="bg-slate-850 hover:bg-slate-800 border border-slate-850 text-slate-350 px-3 py-1.5 rounded text-xs font-semibold transition"
              >
                Cancelar
              </button>
            )}
            <button 
              type="button"
              onClick={handleCreateWorkflow}
              disabled={isSavingWorkflow || workflowSteps.length === 0}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white px-3 py-1.5 rounded text-xs font-semibold transition flex items-center gap-1.5"
            >
              {isSavingWorkflow && <Loader2 className="h-3 w-3 animate-spin" />}
              {isEditingWorkflow ? 'Guardar Cambios' : 'Crear Workflow'}
            </button>
          </div>
        </div>

        {/* Collapsible Advanced Settings */}
        {showAdvancedConfig && (
          <div className="p-4 bg-slate-950/20 border-b border-slate-800/80 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Workflow ID Slug (Opcional)</label>
              <input
                type="text"
                placeholder="e.g. error-diagnose-pr"
                value={newWorkflow.id}
                onChange={e => setNewWorkflow({ ...newWorkflow, id: e.target.value.toLowerCase().trim().replace(/\s+/g, '-') })}
                disabled={isEditingWorkflow}
                className="w-full bg-slate-950 border border-slate-850 rounded p-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500 disabled:opacity-50 font-mono"
              />
              <p className="text-[10px] text-slate-505 mt-0.5">Identificador único del workflow. Se genera automáticamente si está vacío.</p>
            </div>
          </div>
        )}

        {/* Main designer split pane */}
        <div className="flex flex-col lg:flex-row min-h-[500px]">
          
          {/* Left Pane: Palette & Node List */}
          <div className="w-full lg:w-[45%] border-r border-slate-800 flex flex-col">
            {/* Step Palette Button */}
            <div className="p-4 border-b border-slate-800 bg-slate-950/20 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-350 block font-sans">Diseño de Pipeline</span>
                <span className="text-[10px] text-slate-500 font-sans block">Añade nodos y conecta sus flujos</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setInsertBetweenContext(null);
                  setIsCatalogModalOpen(true);
                }}
                className="bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-450 border border-emerald-500/20 hover:border-emerald-500/40 px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 select-none"
              >
                <Plus className="h-4 w-4" />
                Agregar Paso
              </button>
            </div>

            {workflowSteps.length > 0 && (
              <div className="px-4 pt-3 pb-2 border-b border-slate-800 bg-slate-950/20 flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Vista:</span>
                <div className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 gap-0.5">
                  <button
                    type="button"
                    onClick={() => setCanvasView('list')}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold transition flex items-center gap-1.5 ${
                      canvasView === 'list'
                        ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    <List className="h-3.5 w-3.5" /> Lista
                  </button>
                  <button
                    type="button"
                    onClick={() => setCanvasView('graph')}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold transition flex items-center gap-1.5 ${
                      canvasView === 'graph'
                        ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    <Network className="h-3.5 w-3.5" /> Grafo
                  </button>
                </div>
              </div>
            )}

            {canvasView === 'graph' && workflowSteps.length > 0 ? (
              <div className="flex-1 overflow-hidden min-h-[540px]">
                <FlowGraph
                  steps={workflowSteps}
                  selectedStepId={selectedStepId}
                  onSelectStep={(stepId) => setSelectedStepId(stepId)}
                  onAddNodeBetween={(fromId, toId, label) => {
                    setInsertBetweenContext({ fromId, toId, label });
                    setIsCatalogModalOpen(true);
                  }}
                  onDeleteStepDirect={handleDeleteStepDirect}
                />
              </div>
            ) : (
            /* Nodes List */
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-900/10 max-h-[550px]">
              {workflowSteps.length === 0 ? (
                <div className="text-center text-slate-500 py-10 flex flex-col items-center justify-center">
                  <Boxes className="h-10 w-10 mb-3 opacity-20 text-slate-400 animate-pulse" />
                  <p className="text-sm font-semibold text-slate-300">Pipeline vacía</p>
                  <p className="text-xs text-slate-600 mt-1 max-w-[260px]">Arrancá desde cero (usá la paleta de arriba) o empezá más rápido con una plantilla lista para editar.</p>
                  <div className="mt-4 w-full max-w-[280px] space-y-2">
                    <button
                      type="button"
                      onClick={() => handleOpenTemplateModal()}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-2 rounded border border-emerald-500/30 transition flex items-center justify-center gap-1.5"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Comenzar desde plantilla
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateEmptyWorkflow}
                      className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2 rounded border border-slate-700 transition"
                    >
                      Crear vacía
                    </button>
                  </div>
                </div>
              ) : (
                workflowSteps.map((step, idx) => {
                  const styleInfo = getStepStyle(step);
                  const StepIcon = styleInfo.icon;
                  const isSelected = selectedStepId === step.id;
                  
                  return (
                    <div key={step.id} className="flex flex-col items-center w-full">
                      {/* Step Card */}
                      <div
                        onClick={() => setSelectedStepId(step.id)}
                        className={`w-full p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                          isSelected
                            ? 'bg-slate-800 border-emerald-500/60 shadow-lg ring-1 ring-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                            : 'bg-slate-950 border-slate-800 hover:bg-slate-800/40'
                        } ${styleInfo.colorClass}`}
                      >
                        <div className="flex items-center gap-4">
                          <span className="text-xs font-mono font-bold bg-slate-900/80 px-2 py-0.5 border border-slate-800 text-slate-400 rounded-md">
                            {idx + 1}
                          </span>
                          <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
                            <StepIcon className="h-4 w-4" />
                          </div>
                          <div className="text-left">
                            <span className="text-sm font-semibold text-slate-200 block font-mono">{step.config?.name || step.id}</span>
                           <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block mt-0.5">
                              {styleInfo.label}
                            </span>
                            {(() => {
                              const state = getStepConfigurationState(step);
                              return <span className={`text-[10px] mt-1 block font-semibold ${state === 'listo' ? 'text-emerald-400' : state === 'revisar' ? 'text-rose-400' : 'text-amber-400'}`}>
                                {state === 'listo' ? 'Configuración lista' : state === 'revisar' ? 'Revisar conexiones' : 'Falta configuración'}
                              </span>;
                            })()}
                            {step.type === 'trigger' && step.config?.triggerType && (
                              <span className="text-[11px] text-emerald-400 font-mono mt-0.5 block">
                                Type: {step.config.triggerType}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {step.nextStepIds.length > 0 && (
                            <span className="text-[11px] font-mono text-slate-500 border border-slate-800 bg-slate-900 px-2 py-0.5 rounded">
                              Next: {step.nextStepIds.join(', ')}
                            </span>
                          )}
                          <SafeDeleteButton
                            onDelete={() => handleDeleteStep(step.id)}
                            className="text-slate-500 hover:text-rose-500 p-1.5 bg-slate-900 hover:bg-rose-500/10 rounded-lg border border-slate-800 transition"
                            title="Eliminar paso"
                          />
                        </div>
                      </div>

                      {/* Visual pipeline connector logic */}
                      {(() => {
                        if (step.type === 'condition') {
                          const onTrueTarget = step.config?.onTrue;
                          const onFalseTarget = step.config?.onFalse;
                          return (
                            <div className="w-full flex flex-col items-center my-3 relative">
                              {/* Horizontal bridge line between branches */}
                              <div className="absolute top-0 h-0.5 bg-slate-800 left-[25%] right-[25%]" />
                              
                              <div className="w-full flex items-start justify-center pt-2">
                                {/* Left Branch - True (Green) */}
                                <div className="w-1/2 flex flex-col items-center relative">
                                  <div className="absolute -top-2 left-1/2 w-0.5 h-4 bg-emerald-500/40 -translate-x-1/2" />
                                  <div className="mt-2 z-10 flex flex-col items-center">
                                    <span className="text-[11px] font-bold text-emerald-400 bg-emerald-900/90 border border-emerald-500/40 px-2.5 py-0.5 rounded shadow flex items-center gap-1 font-mono">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                      True: {onTrueTarget || 'End'}
                                    </span>
                                    <svg className="w-3.5 h-3.5 text-emerald-500 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                </div>

                                {/* Right Branch - False (Red) */}
                                <div className="w-1/2 flex flex-col items-center relative">
                                  <div className="absolute -top-2 left-1/2 w-0.5 h-4 bg-rose-500/40 -translate-x-1/2" />
                                  <div className="mt-2 z-10 flex flex-col items-center">
                                    <span className="text-[11px] font-bold text-rose-400 bg-rose-950/90 border border-rose-500/40 px-2.5 py-0.5 rounded shadow flex items-center gap-1 font-mono">
                                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                                      False: {onFalseTarget || 'End'}
                                    </span>
                                    <svg className="w-3.5 h-3.5 text-rose-500 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        const nextStepId = step.nextStepIds[0];
                        if (nextStepId) {
                          const isDirectSuccessor = idx + 1 < workflowSteps.length && workflowSteps[idx + 1].id === nextStepId;
                          return (
                            <div className="flex flex-col items-center my-2 w-full relative">
                              <div className="w-0.5 h-8 bg-gradient-to-b from-slate-800 to-emerald-500/50 relative">
                                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-10">
                                  <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </div>
                              {!isDirectSuccessor && (
                                <span className="text-[11px] font-mono text-emerald-400 bg-slate-900 border border-emerald-500/20 px-2 py-0.5 rounded mt-2 shadow">
                                  Goes to: {nextStepId}
                                </span>
                              )}
                            </div>
                          );
                        }

                        // Neutral connector line if there are subsequent cards in the array
                        if (idx < workflowSteps.length - 1) {
                          return (
                            <div className="flex flex-col items-center my-2 w-full">
                              <div className="w-0.5 h-6 border-l border-dashed border-slate-800" />
                            </div>
                          );
                        }

                        return null;
                      })()}
                    </div>
                  );
                })
              )}
            </div>
            )}
          </div>

          {/* Right Pane: Inspector Panel */}
          <div className="flex-1 bg-slate-950 p-6 border-t lg:border-t-0 border-slate-800 flex flex-col overflow-y-auto max-h-[650px]">
            {selectedStepId ? (
              <>
                {(() => {
                  const step = workflowSteps.find(s => s.id === selectedStepId);
                if (!step) return <div className="text-slate-500">Step not found.</div>;
                
                const styleInfo = getStepStyle(step);
                const StepIcon = styleInfo.icon;
                
                return (
                  <div className="space-y-6 text-left">
                    {/* Inspector Header */}
                    <div className="flex justify-between items-start pb-4 border-b border-slate-850">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded bg-slate-900 border border-slate-800 text-emerald-400">
                          <StepIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="text-base font-bold text-slate-100 font-mono">{step.id}</h4>
                          <span className="text-xs text-slate-500 uppercase font-semibold tracking-wider font-sans">
                            Inspector &middot; {step.type}
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] bg-slate-900 border border-slate-850 px-2 py-0.5 rounded text-slate-400 font-mono">
                        Config Node
                      </span>
                    </div>

                    {/* Tabs Selector for Inspector */}
                    <div className="flex border-b border-slate-800 bg-slate-900/30 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-5">
                      {[
                        { id: 'config', label: 'Configuración', icon: Sliders },
                        { id: 'routing', label: 'Conexiones', icon: Network },
                        { id: 'inputs', label: 'Variables', icon: Braces }
                      ].map(t => {
                        const Icon = t.icon;
                        const isActive = inspectorTab === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setInspectorTab(t.id as any)}
                            className={`flex-1 py-2.5 px-1 flex flex-col items-center justify-center gap-1 border-b-2 font-sans transition ${
                              isActive
                                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                                : 'border-transparent hover:text-slate-200 hover:bg-slate-800/30'
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span>{t.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    {inspectorTab === 'config' && (
                      <div className="space-y-6">
                        {/* Unique ID (Read-only) */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 mb-1">Unique ID</label>
                          <div className="w-full bg-slate-900/50 border border-slate-800 rounded p-2 text-sm text-slate-400 font-mono select-all">
                            {step.id}
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1 font-sans">Technical identifier used in data flow references.</p>
                        </div>

                        {/* Editable readable label (optional) */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 mb-1.5">Readable Label (optional)</label>
                          <input
                            type="text"
                            placeholder="e.g. Mi Paso de Proceso"
                            value={step.config?.name || ''}
                            onChange={e => handleUpdateStepConfig(step.id, { name: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                          />
                          <p className="text-[11px] text-slate-500 mt-1 font-sans">Shown as the step title in the canvas. Leave empty to use the technical ID.</p>
                        </div>

                        {/* Node-specific configuration fields */}
                        <div className="space-y-4 pt-4 border-t border-slate-850">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-2 font-sans">Propiedades del Nodo</span>

                      {/* TRIGGER NODE */}
                      {step.type === 'trigger' && (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Trigger Type</label>
                            <select
                              value={step.config?.triggerType || ''}
                              onChange={e => handleUpdateStepConfig(step.id, { triggerType: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                            >
                              <option value="">-- Select trigger source --</option>
                              <option value="cron">Cron Scheduler (Timer Loop)</option>
                              <option value="webhook">Webhook HTTP Endpoint (Postman/Alerts)</option>
                            </select>
                          </div>

                          {step.config?.triggerType === 'cron' && (
                            <div className="space-y-3 font-sans">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-semibold text-slate-400">Frecuencia rápida:</span>
                                {CRON_PRESETS.map(preset => (
                                  <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => updateSimpleCronConfig(step.id, { cronExpression: preset.expression, cronFrequency: preset.frequency, cronHour: preset.hour, cronMinute: preset.minute })}
                                    className="text-[10px] bg-slate-800 hover:bg-emerald-600/30 hover:text-emerald-300 text-slate-300 px-2 py-1 rounded border border-slate-700 transition"
                                  >
                                    {preset.label}
                                  </button>
                                ))}
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Expresión Cron</label>
                                  <input
                                    type="text"
                                    placeholder="0 9 * * 1-5"
                                    value={step.config?.cronExpression || ''}
                                    onChange={e => handleUpdateStepConfig(step.id, { cronExpression: e.target.value })}
                                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                                  />
                                  {(() => {
                                    const expr = step.config?.cronExpression;
                                    if (!expr) return null;
                                    const res = validateCronExpression(expr);
                                    return (
                                      <span className={`text-[10px] mt-1 block ${res.isValid ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {res.isValid ? 'Expresión válida' : res.error}
                                      </span>
                                    );
                                  })()}
                                </div>
                                  <div>
                                    <FieldLabel hint="La zona IANA determina la hora local usada por el scheduler. Ejemplos: GMT-3, GMT+0 (UTC).">Zona horaria</FieldLabel>
                                    <select
                                      value={step.config?.timezone || 'America/Bogota'}
                                      onChange={e => handleUpdateStepConfig(step.id, { timezone: e.target.value })}
                                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                                    >
                                      {step.config?.timezone && !TIMEZONE_OPTIONS.some(option => option.value === step.config.timezone) && (
                                        <option value={step.config.timezone}>{step.config.timezone}</option>
                                      )}
                                      {TIMEZONE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                    <ConfigHint>Se guarda el identificador técnico, pero elegís por offset y ciudad.</ConfigHint>
                                  </div>
                              </div>
                              <div className="text-[10px] text-slate-500 flex items-start gap-1 font-sans bg-slate-900 p-2 border border-slate-850 rounded">
                                <Info className="h-4 w-4 text-emerald-400 shrink-0" />
                                <span>Sintaxis cron estándar de 5 campos (minutos, horas, día del mes, mes, día de la semana). Se registra en el programador activo.</span>
                              </div>
                            </div>
                          )}

                          {step.config?.triggerType === 'webhook' && (
                            <div className="space-y-4 font-sans">
                              {newWorkflow.id ? (
                                <div className="space-y-2">
                                  <label className="block text-xs font-semibold text-slate-400">Webhook Endpoint URL</label>
                                  <div className="flex items-center gap-2 bg-slate-900 border border-slate-850 p-2.5 rounded font-mono text-xs text-slate-300">
                                    <span className="flex-1 break-all select-all">{`http://127.0.0.1:3001/webhooks/webhook-${newWorkflow.id}-${step.id}`}</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard.writeText(`http://127.0.0.1:3001/webhooks/webhook-${newWorkflow.id}-${step.id}`);
                                        onShowNotification('Copied Webhook URL!', 'info');
                                      }}
                                      className="text-slate-450 hover:text-slate-200 p-1.5 hover:bg-slate-800 rounded transition border border-slate-800"
                                      title="Copy URL"
                                    >
                                      <Copy className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs text-amber-500 bg-amber-500/10 p-3 rounded border border-amber-500/20 flex items-center gap-1.5">
                                  <AlertTriangle className="h-4 w-4" />
                                  <span>Enter a Workflow ID Slug above to view the webhook endpoint details.</span>
                                </div>
                              )}

                              <div className="bg-slate-900 border border-slate-850 p-4 rounded-lg space-y-3">
                                <span className="text-xs font-semibold text-slate-300 block">Security Bearer Authorization</span>
                                
                                {generatedTokens[step.id] ? (
                                  <div className="space-y-2">
                                    <div className="text-xs text-emerald-450 bg-emerald-500/10 p-3 rounded border border-emerald-500/20 flex items-center gap-1">
                                      <CheckCircle className="h-3.5 w-3.5" />
                                      <span>Token created! Copy it now (will not be displayed again).</span>
                                    </div>
                                    <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 p-2 rounded text-xs font-mono text-slate-200">
                                      <span className="flex-1 select-all break-all pr-4">{showTokenMap[step.id] ? generatedTokens[step.id] : '••••••••••••••••••••••••••••••••••••••••••••••••'}</span>
                                      <button
                                        type="button"
                                        onClick={() => setShowTokenMap({ ...showTokenMap, [step.id]: !showTokenMap[step.id] })}
                                        className="text-slate-450 hover:text-slate-250 p-1 rounded"
                                      >
                                        {showTokenMap[step.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          navigator.clipboard.writeText(generatedTokens[step.id]);
                                          onShowNotification('Copied token to clipboard!', 'info');
                                        }}
                                        className="text-slate-400 hover:text-slate-200 p-1.5 rounded hover:bg-slate-850 border border-slate-800"
                                      >
                                        <Copy className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                    <div className="flex justify-between items-center gap-3">
                                     <span className="text-xs text-slate-500">Bearer token configured. Double-click to generate a new one if necessary.</span>
                                     <button
                                       type="button"
                                       onDoubleClick={() => {
                                         handleUpdateStepConfig(step.id, { regenerateToken: true });
                                         onShowNotification('Token regeneration queued. Save the workflow to apply.', 'info');
                                       }}
                                       className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded font-semibold border border-slate-700 transition"
                                       title="Rotar Bearer Token (Doble clic)"
                                     >
                                       {step.config?.regenerateToken ? 'Rotation Queued' : 'Rotate Token'}
                                     </button>
                                   </div>
                                )}
                              </div>

                              {/* Webhook Payload Schema Editor */}
                              <WebhookSchemaEditor
                                schema={step.config?.payloadSchema || []}
                                onChange={payloadSchema => handleUpdateStepConfig(step.id, { payloadSchema })}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {/* CODE / PYTHON NODES */}
                      {(step.type === 'code' || step.type === 'python') && (
                        <div className="space-y-4 font-sans">
                          {step.type === 'code' && (
                            <div>
                              <FieldLabel hint="JavaScript corre en el sandbox del runner. Python usa el intérprete local del proyecto.">Lenguaje</FieldLabel>
                              <select
                                value={step.config?.language || 'javascript'}
                                onChange={e => handleUpdateStepConfig(step.id, { language: e.target.value, source: e.target.value === 'python' ? (step.config?.source || 'inline') : 'inline' })}
                                className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                              >
                                <option value="javascript">JavaScript</option>
                                <option value="python">Python</option>
                              </select>
                            </div>
                          )}
                          {(step.type === 'python' || step.config?.language === 'python') && (
                            <div>
                              <FieldLabel hint="Elegí código inline para editarlo aquí o un archivo relativo dentro del proyecto.">Origen del script</FieldLabel>
                              <div className="flex gap-2">
                                {(['inline', 'file'] as const).map(source => (
                                  <button key={source} type="button" onClick={() => handleUpdateStepConfig(step.id, { source })} className={`rounded-lg border px-3 py-1.5 text-xs transition ${((step.config?.source || 'inline') === source) ? 'border-amber-400 bg-amber-400/15 text-amber-200' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                                    {source === 'inline' ? 'Editor integrado' : 'Archivo del proyecto'}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {((step.type !== 'python' && step.config?.language !== 'python') || (step.config?.source || 'inline') === 'inline') && (
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <FieldLabel hint="El script recibe context.triggerPayload, context.stepOutputs y context.variables. Debe devolver un resultado.">Código</FieldLabel>
                                {step.type !== 'python' && step.config?.language !== 'python' && (
                                  <select defaultValue="" onChange={e => { if (e.target.value) handleUpdateStepConfig(step.id, { code: e.target.value }); e.currentTarget.value = ''; }} className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[10px] text-slate-400">
                                    <option value="">Insertar ejemplo…</option>
                                    <option value={'return { success: true, payload: context.triggerPayload };'}>Devolver payload</option>
                                    <option value={'const input = context.triggerPayload;\nreturn { success: true, result: input };'}>Transformar datos</option>
                                  </select>
                                )}
                              </div>
                              <textarea
                                rows={12}
                                value={step.config?.code || ''}
                                onChange={e => handleUpdateStepConfig(step.id, { code: e.target.value })}
                                placeholder={step.config?.language === 'python' ? 'result = context["triggerPayload"]' : '// Escribe tu script aquí\nreturn { success: true };'}
                                className={`w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm font-mono focus:outline-none resize-y ${step.config?.language === 'python' ? 'text-amber-300 focus:border-amber-500' : 'text-emerald-300 focus:border-emerald-500'}`}
                              />
                              <ConfigHint>Tip: escribí <code className="text-emerald-400 font-mono">{'{{'}</code> en campos de texto para insertar variables de pasos anteriores.</ConfigHint>
                            </div>
                          )}
                          {step.config?.language === 'python' && (step.config?.source || 'inline') === 'file' && (
                            <div>
                              <FieldLabel hint="Debe ser una ruta relativa, por ejemplo scripts/transform.py. Nunca uses rutas absolutas ni ..">Ruta relativa del archivo</FieldLabel>
                              <input value={step.config?.filePath || ''} onChange={e => handleUpdateStepConfig(step.id, { filePath: e.target.value })} placeholder="scripts/transform.py" className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-amber-500" />
                            </div>
                          )}
                          {step.config?.language === 'python' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <FieldLabel hint={'Array JSON de argumentos que recibe el script. Ejemplo: ["--mode", "fast"]'}>Argumentos</FieldLabel>
                                <input value={typeof step.config?.args === 'string' ? step.config.args : JSON.stringify(step.config?.args || [])} onChange={e => handleUpdateStepConfig(step.id, { args: e.target.value })} placeholder='["--mode", "fast"]' className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-amber-500" />
                              </div>
                              <div>
                                <FieldLabel hint="Tiempo máximo de ejecución del script, en milisegundos.">Timeout (ms)</FieldLabel>
                                <input type="number" min="1" max="300000" value={step.config?.timeoutMs ?? 30000} onChange={e => handleUpdateStepConfig(step.id, { timeoutMs: Number(e.target.value) })} className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-amber-500" />
                              </div>
                            </div>
                          )}
                          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-slate-300">
                            <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                            <span>La validación del workflow comprobará código vacío, ruta, argumentos y timeout antes de guardar.</span>
                          </div>
                        </div>
                      )}

                      {/* HTTP REQUEST NODE */}
                      {step.type === 'http_request' && (
                        <div className="space-y-4 font-sans">
                          <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-3">
                            <div>
                              <FieldLabel hint="Método HTTP que se enviará al endpoint.">Método</FieldLabel>
                              <select value={step.config?.method || 'GET'} onChange={e => handleUpdateStepConfig(step.id, { method: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500">
                                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => <option key={method} value={method}>{method}</option>)}
                              </select>
                            </div>
                            <div>
                              <FieldLabel hint="URL completa del endpoint. Acepta variables, por ejemplo https://api.example.com/users/{{context.triggerPayload.userId}}.">URL del request</FieldLabel>
                              <TemplateField value={step.config?.url || ''} onChange={v => handleUpdateStepConfig(step.id, { url: v })} placeholder="https://api.example.com/data" hint="Debe comenzar con http:// o https://." workflowSteps={workflowSteps} selectedStepId={step.id} />
                            </div>
                          </div>
                          <div>
                            <FieldLabel hint="Objeto JSON de cabeceras. Nunca pegues secretos reales si el workflow se versiona; usa referencias a secretos.">Headers (JSON)</FieldLabel>
                            <TemplateField rows={4} value={typeof step.config?.headers === 'string' ? step.config.headers : JSON.stringify(step.config?.headers || {}, null, 2)} onChange={v => { try { handleUpdateStepConfig(step.id, { headers: JSON.parse(v) }); } catch { handleUpdateStepConfig(step.id, { headers: v }); } }} placeholder={'{\n  "Content-Type": "application/json"\n}'} hint="Ejemplo: { &quot;X-Request-Id&quot;: &quot;{{context.triggerPayload.id}}&quot; }." workflowSteps={workflowSteps} selectedStepId={step.id} />
                          </div>
                          <div>
                            <FieldLabel hint="Cuerpo enviado al endpoint. Normalmente es JSON para POST, PUT o PATCH.">Body (opcional)</FieldLabel>
                            <TemplateField rows={5} value={step.config?.body || ''} onChange={v => handleUpdateStepConfig(step.id, { body: v })} placeholder={'{\n  "name": "{{context.triggerPayload.name}}"\n}'} workflowSteps={workflowSteps} selectedStepId={step.id} />
                          </div>
                          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 space-y-3">
                            <FieldLabel hint="Bearer agrega automáticamente Authorization: Bearer <token> al request.">Autenticación</FieldLabel>
                            <select value={step.config?.authType || 'none'} onChange={e => handleUpdateStepConfig(step.id, { authType: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500">
                              <option value="none">Sin autenticación</option><option value="bearer">Bearer token</option>
                            </select>
                            {step.config?.authType === 'bearer' && <div><FieldLabel hint="Token de API o referencia como {{secrets.api_token}}. Se enmascara y no debe aparecer en logs.">Bearer token</FieldLabel><input type="password" value={step.config?.bearerToken || ''} onChange={e => handleUpdateStepConfig(step.id, { bearerToken: e.target.value })} placeholder="{{secrets.api_token}}" className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-sky-500" /></div>}
                          </div>
                        </div>
                      )}

                      {/* DISCORD NODE */}
                      {step.type === 'discord_notify' && (
                        <div className="space-y-4 font-sans">
                          <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs text-slate-300">Discord usa un webhook entrante. Guardá la URL como secreto o referencia y no la compartas en el repositorio.</div>
                          <div>
                            <FieldLabel hint="URL del webhook entrante creado en Discord. Ejemplo: https://discord.com/api/webhooks/...">Webhook URL</FieldLabel>
                            <input type="password" value={step.config?.webhookUrl || ''} onChange={e => handleUpdateStepConfig(step.id, { webhookUrl: e.target.value })} placeholder="https://discord.com/api/webhooks/..." className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-indigo-500" />
                            <ConfigHint>Podés usar una referencia como {'{{secrets.discord_webhook}}'}.</ConfigHint>
                          </div>
                          <div>
                            <FieldLabel hint="Texto de la notificación. Admite variables de pasos anteriores y hasta 2000 caracteres en Discord.">Mensaje</FieldLabel>
                            <TemplateField rows={5} value={step.config?.message || step.config?.content || ''} onChange={v => handleUpdateStepConfig(step.id, { message: v, content: v })} placeholder="El proceso terminó: {{context.stepOutputs.code.result}}" workflowSteps={workflowSteps} selectedStepId={step.id} />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div><FieldLabel hint="Nombre opcional que mostrará el webhook en Discord.">Nombre del bot (opcional)</FieldLabel><input value={step.config?.username || ''} onChange={e => handleUpdateStepConfig(step.id, { username: e.target.value })} placeholder="OpenCode Bot" className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" /></div>
                            <div><FieldLabel hint="URL HTTPS opcional de una imagen para el avatar del bot.">Avatar URL (opcional)</FieldLabel><input value={step.config?.avatarUrl || ''} onChange={e => handleUpdateStepConfig(step.id, { avatarUrl: e.target.value })} placeholder="https://.../avatar.png" className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" /></div>
                          </div>
                        </div>
                      )}

                      {['code', 'python', 'http_request', 'discord_notify'].includes(step.type) && (
                        <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                          <button type="button" onClick={() => handleValidateNode(step)} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition">
                            <CheckCircle className="h-3.5 w-3.5" /> Validar configuración
                          </button>
                          {nodeValidation?.stepId === step.id && <span className={`text-[11px] ${nodeValidation.valid ? 'text-emerald-400' : 'text-rose-400'}`}>{nodeValidation.valid ? '✓' : '✕'} {nodeValidation.message}</span>}
                        </div>
                      )}

                      {/* AGENT NODE */}
                      {step.type === 'agent' && (
                        <div className="space-y-4 font-sans">
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Target Project Workspace</label>
                            <select
                              value={step.config?.projectId || ''}
                              onChange={e => handleUpdateStepConfig(step.id, { projectId: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                            >
                              <option value="">Default Temp Workspace (Isolated)</option>
                              {projects.map(p => (
                                <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                              ))}
                            </select>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Agent Role Preset</label>
                              <select
                                value={step.config?.agent || 'engineer'}
                                onChange={e => handleUpdateStepConfig(step.id, { agent: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                              >
                                <option value="engineer">Software Engineer (Write/Edit Code)</option>
                                <option value="diagnoser">QA Diagnoser (Find Bugs/Errors)</option>
                                <option value="reviewer">Reviewer Agent (Verify/Inspect)</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Proveedor (Provider)</label>
                              <select
                                value={step.config?.provider || 'google'}
                                onChange={e => handleAgentProviderChange(step.id, e.target.value)}
                                className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                              >
                                <option value="openai">OpenAI</option>
                                <option value="anthropic">Anthropic</option>
                                <option value="google">Google</option>
                                <option value="ollama">Ollama (local)</option>
                                <option value="custom">Otro / Custom</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Model ID</label>
                            {step.config?.provider === 'custom' ? (
                              <input
                                type="text"
                                placeholder="e.g. mistral-large-latest"
                                value={step.config?.model || ''}
                                onChange={e => handleUpdateStepConfig(step.id, { model: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                              />
                            ) : (
                              <select
                                value={step.config?.model || (PROVIDER_MODELS[step.config?.provider as ProviderId] || [''])[0] || ''}
                                onChange={e => handleUpdateStepConfig(step.id, { model: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                              >
                                {(PROVIDER_MODELS[step.config?.provider as ProviderId] || []).map(m => (
                                  <option key={m} value={m}>{m}</option>
                                ))}
                              </select>
                            )}
                          </div>
                          <div>
                            <TemplateField
                              label="Prompt Template Instruction"
                              rows={6}
                              placeholder="e.g. Diagnose and resolve this issue: {{message}}"
                              value={step.config?.prompt || ''}
                              onChange={v => handleUpdateStepConfig(step.id, { prompt: v })}
                              workflowSteps={workflowSteps}
                              selectedStepId={step.id}
                              hint={`Templating values, e.g. {"{{message}}"}, {"{{stepOutputs.normalizer_step.message}}"}. Key paths evaluate against execution context.`}
                            />
                          </div>
                        </div>
                      )}

                      {/* CONDITION NODE */}
                      {step.type === 'condition' && (
                        <div className="space-y-4 font-sans">
                          <div>
                            <TemplateField
                              label="Condition JS Expression"
                              placeholder="context.stepOutputs.agent1.success === true"
                              value={step.config?.expression || ''}
                              onChange={v => handleUpdateStepConfig(step.id, { expression: v })}
                              workflowSteps={workflowSteps}
                              selectedStepId={step.id}
                              mono={false}
                              hint="Expression must return a boolean value. Reference `context` object."
                            />
                            <div className="mt-2 flex items-start gap-2 bg-slate-900/40 border border-slate-800 rounded-lg p-2.5 text-[11px] text-slate-400 font-sans">
                              <Info className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                              <span>
                                This condition decides which branch runs next. Type <code className="text-emerald-400 font-mono">{'{{'}</code> to see a list of available variables and auto-complete them. Compare a value with <code className="text-slate-300 font-mono">===</code> or check if it exists, e.g. <code className="text-slate-300 font-mono">context.stepOutputs.agent1.success === true</code>.
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* SHELL NODE */}
                      {step.type === 'shell_test' && (
                        <div>
                          <div className="mb-4">
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Target Project Workspace</label>
                            <select
                              value={step.config?.projectId || ''}
                              onChange={e => handleUpdateStepConfig(step.id, { projectId: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                            >
                              <option value="">Default Temp Workspace (Isolated)</option>
                              {projects.map(p => (
                                <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                              ))}
                            </select>
                          </div>
                          <TemplateField
                            label="Shell Command"
                            placeholder="npm test"
                            value={step.config?.command || ''}
                            onChange={v => handleUpdateStepConfig(step.id, { command: v })}
                            workflowSteps={workflowSteps}
                            selectedStepId={step.id}
                            hint="Command prefix must match the project pre-authorized commands checklist."
                          />
                        </div>
                      )}

                      {/* NORMALIZER NODE */}
                      {step.type === 'normalizer' && (
                        <div className="space-y-4">
                          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-3">
                            <div>
                               <label className="block text-xs font-semibold text-cyan-300 mb-1.5">Mapeo de entrada</label>
                               <p className="text-[10px] text-slate-500 mt-1">Normaliza propiedades del payload mediante un mapeo. Para parsear JSON y extraer rows usá el nodo independiente JSON Parser.</p>
                             </div>
                          </div>
                          <TemplateField
                            label="JSON Payload Mapping"
                            rows={5}
                            placeholder='{ "message": "triggerPayload.message" }'
                            value={typeof step.config?.mapping === 'object' ? JSON.stringify(step.config?.mapping, null, 2) : step.config?.mapping || ''}
                            onChange={v => {
                              try {
                                const parsed = JSON.parse(v);
                                handleUpdateStepConfig(step.id, { mapping: parsed });
                              } catch (err) {
                                handleUpdateStepConfig(step.id, { mapping: v });
                              }
                            }}
                            workflowSteps={workflowSteps}
                            selectedStepId={step.id}
                          />
                        </div>
                      )}

                      {/* GIT NODE */}
                      {step.type === 'git' && (
                        <div>
                          <div className="mb-4">
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Target Project Workspace</label>
                            <select
                              value={step.config?.projectId || ''}
                              onChange={e => handleUpdateStepConfig(step.id, { projectId: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                            >
                              <option value="">Default Temp Workspace (Isolated)</option>
                              {projects.map(p => (
                                <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                              ))}
                            </select>
                          </div>
                          <TemplateField
                            label="Git Commit Message"
                            placeholder="fix: resolving platform error"
                            value={step.config?.commitMessage || ''}
                            onChange={v => handleUpdateStepConfig(step.id, { commitMessage: v })}
                            workflowSteps={workflowSteps}
                            selectedStepId={step.id}
                          />
                        </div>
                      )}

                      {/* PR NODE */}
                      {step.type === 'pr' && (
                        <div className="space-y-4">
                          <div className="mb-4">
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Target Project Workspace</label>
                            <select
                              value={step.config?.projectId || ''}
                              onChange={e => handleUpdateStepConfig(step.id, { projectId: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                            >
                              <option value="">Default Temp Workspace (Isolated)</option>
                              {projects.map(p => (
                                <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Pull Request Title</label>
                            <input
                              type="text"
                              placeholder="OpenCode Auto-Fix"
                              value={step.config?.title || ''}
                              onChange={e => handleUpdateStepConfig(step.id, { title: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                            />
                          </div>
                          <div>
                            <TemplateField
                              label="PR Body Description"
                              rows={4}
                              placeholder="Proposed agent code modifications."
                              value={step.config?.body || ''}
                              onChange={v => handleUpdateStepConfig(step.id, { body: v })}
                              workflowSteps={workflowSteps}
                              selectedStepId={step.id}
                            />
                          </div>
                        </div>
                      )}

                      {/* TRANSFORM NODE */}
                      {step.type === 'transform' && (
                        <div>
                          <TemplateField
                            label="Formatting Template"
                            rows={5}
                            placeholder="Report:\n{{context.stepOutputs.agent1.output}}"
                            value={step.config?.template || ''}
                            onChange={v => handleUpdateStepConfig(step.id, { template: v })}
                            workflowSteps={workflowSteps}
                            selectedStepId={step.id}
                          />
                        </div>
                      )}

                      {/* OUTPUT NODE */}
                      {step.type === 'output' && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-sans">Output Channel</label>
                              <select
                                value={step.config?.outputType || 'file'}
                                onChange={e => handleUpdateStepConfig(step.id, { outputType: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-sans"
                              >
                                <option value="file">Local Workspace File</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Relative File Path</label>
                              <input
                                type="text"
                                placeholder="opencode-report.txt"
                                value={step.config?.filePath || ''}
                                onChange={e => handleUpdateStepConfig(step.id, { filePath: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                              />
                            </div>
                          </div>
                          <div>
                            <TemplateField
                              label="Output Payload Content"
                              rows={4}
                              placeholder="{{context.stepOutputs.transform1.outputText}}"
                              value={step.config?.data || ''}
                              onChange={v => handleUpdateStepConfig(step.id, { data: v })}
                              workflowSteps={workflowSteps}
                              selectedStepId={step.id}
                            />
                          </div>
                        </div>
                      )}

                      {/* APPROVAL NODE */}
                      {step.type === 'approval' && (
                        <div>
                          <TemplateField
                            label="Human Approval Instructions"
                            placeholder="Please approve running the test command and pushing."
                            value={step.config?.description || ''}
                            onChange={v => handleUpdateStepConfig(step.id, { description: v })}
                            workflowSteps={workflowSteps}
                            selectedStepId={step.id}
                            mono={false}
                          />
                        </div>
                      )}

                      {/* NOSQL NODE */}
                      {step.type === 'nosql' && (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-sans">Base de Datos</label>
                            <select
                              value={step.config?.databaseId || ''}
                              onChange={e => handleUpdateStepConfig(step.id, { databaseId: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-sans"
                            >
                              <option value="">-- Seleccionar Base de Datos --</option>
                              {databases.map(db => (
                                <option key={db.id} value={db.id}>{db.name} ({db.id})</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-sans">Colección</label>
                            {(() => {
                              const selectedDb = databases.find(d => d.id === (step.config?.databaseId || ''));
                              const availableCollections = selectedDb && selectedDb.collections ? Object.keys(selectedDb.collections) : [];
                              return (
                                <select
                                  value={step.config?.collection || ''}
                                  onChange={e => handleUpdateStepConfig(step.id, { collection: e.target.value })}
                                  disabled={!step.config?.databaseId}
                                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-sans disabled:opacity-50"
                                >
                                  {!step.config?.databaseId ? (
                                    <option value="">-- Seleccione una base de datos primero --</option>
                                  ) : (
                                    <>
                                      <option value="">-- Seleccionar Colección --</option>
                                      {availableCollections.map(collName => (
                                        <option key={collName} value={collName}>{collName}</option>
                                      ))}
                                    </>
                                  )}
                                </select>
                              );
                            })()}
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-sans">Operación</label>
                            <select
                              value={step.config?.operation || 'find'}
                              onChange={e => handleUpdateStepConfig(step.id, { operation: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-sans"
                            >
                              <option value="find">Consultar (Find)</option>
                              <option value="insert">Insertar (Insert)</option>
                              <option value="update">Actualizar (Update)</option>
                              <option value="delete">Eliminar (Delete)</option>
                            </select>
                          </div>
                          <div>
                            <TemplateField
                              label="ID de Documento"
                              placeholder="p. ej. doc_123 o {{context.triggerPayload.userId}}"
                              value={step.config?.documentId || ''}
                              onChange={v => handleUpdateStepConfig(step.id, { documentId: v })}
                              workflowSteps={workflowSteps}
                              selectedStepId={step.id}
                            />
                          </div>
                          {['insert', 'update'].includes(step.config?.operation || 'find') && (
                            <div>
                              <TemplateField
                                label="Datos JSON"
                                rows={5}
                                placeholder='{ "name": "{{context.triggerPayload.name}}", "active": true }'
                                value={typeof step.config?.data === 'object' ? JSON.stringify(step.config?.data, null, 2) : step.config?.data || ''}
                                onChange={v => {
                                  try {
                                    const parsed = JSON.parse(v);
                                    handleUpdateStepConfig(step.id, { data: parsed });
                                  } catch (err) {
                                    handleUpdateStepConfig(step.id, { data: v });
                                  }
                                }}
                                workflowSteps={workflowSteps}
                                selectedStepId={step.id}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {/* PARALLEL NODE */}
                      {step.type === 'parallel' && (
                        <div className="text-slate-500 text-xs italic p-3 bg-slate-900 border border-slate-800 rounded-md">
                          Configurá las ramas paralelas y el nodo de unión en la pestaña de Conexiones.
                        </div>
                      )}

                      {/* LOOP NODE */}
                      {step.type === 'loop' && (
                        <div className="space-y-4">
                          <div>
                            <TemplateField
                              label="Items Expression"
                              placeholder="context.stepOutputs.normalizer.items"
                              value={step.config?.itemsExpr || ''}
                              onChange={v => handleUpdateStepConfig(step.id, { itemsExpr: v })}
                              workflowSteps={workflowSteps}
                              selectedStepId={step.id}
                              hint="Expression that resolves to the array this loop iterates over."
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Item Variable Name</label>
                            <input
                              type="text"
                              placeholder="item"
                              value={step.config?.itemVar || 'item'}
                              onChange={e => handleUpdateStepConfig(step.id, { itemVar: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                            />
                            <p className="text-[11px] text-slate-500 mt-1 font-sans">Each element is exposed under this variable name inside the loop body.</p>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Max Iterations</label>
                            <input
                              type="number"
                              min={1}
                              placeholder="10"
                              value={step.config?.maxIterations ?? ''}
                              onChange={e => handleUpdateStepConfig(step.id, { maxIterations: e.target.value === '' ? undefined : Number(e.target.value) })}
                              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                            />
                          </div>
                        </div>
                      )}

                      {/* RETRY NODE */}
                      {step.type === 'retry' && (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Retries</label>
                            <input
                              type="number"
                              min={0}
                              placeholder="3"
                              value={step.config?.retries ?? ''}
                              onChange={e => handleUpdateStepConfig(step.id, { retries: e.target.value === '' ? undefined : Number(e.target.value) })}
                              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Retry Delay (ms)</label>
                            <input
                              type="number"
                              min={0}
                              placeholder="1000"
                              value={step.config?.retryDelayMs ?? ''}
                              onChange={e => handleUpdateStepConfig(step.id, { retryDelayMs: e.target.value === '' ? undefined : Number(e.target.value) })}
                              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                            />
                            <p className="text-[11px] text-slate-500 mt-1 font-sans">Wait time between attempts.</p>
                          </div>
                        </div>
                      )}

                      {/* WAIT NODE */}
                      {step.type === 'wait' && (
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 mb-1.5">Duration (ms)</label>
                          <input
                            type="number"
                            min={0}
                            placeholder="5000"
                            value={step.config?.durationMs ?? ''}
                            onChange={e => handleUpdateStepConfig(step.id, { durationMs: e.target.value === '' ? undefined : Number(e.target.value) })}
                            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                          />
                          <p className="text-[11px] text-slate-500 mt-1 font-sans">Pauses the pipeline for this duration before continuing.</p>
                        </div>
                      )}

                      {/* Context Variable Copier Panel */}
                      {/* Enrutamiento e inputs reubicados en sus respectivas pestañas del inspector */}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

              {/* Contenido de pestañas adicionales de conexiones y variables */}
              {selectedStepId && (
                (() => {
                  const step = workflowSteps.find(s => s.id === selectedStepId);
                  if (!step) return null;

                  return (
                    <div className="text-left">
                      {/* Routing and Connections Tab */}
                      {inspectorTab === 'routing' && (
                        <div className="space-y-5">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block font-sans">
                            Conexiones y Ruteo
                          </span>

                          {step.type === 'condition' ? (
                            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4 font-sans">
                              <span className="text-[11px] font-bold text-slate-400 block">Flujo de Condición</span>
                              <div className="grid grid-cols-1 gap-4">
                                <div>
                                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Branch on True (Sí / True)</label>
                                  <select
                                    value={step.config?.onTrue || ''}
                                    onChange={e => handleUpdateStepConfig(step.id, { onTrue: e.target.value })}
                                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                                  >
                                    <option value="">-- [Fin del Flujo] --</option>
                                    {workflowSteps
                                      .filter(s => s.id !== step.id)
                                      .map(s => (
                                        <option key={s.id} value={s.id}>{s.id} ({s.type})</option>
                                      ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Branch on False (No / False)</label>
                                  <select
                                    value={step.config?.onFalse || ''}
                                    onChange={e => handleUpdateStepConfig(step.id, { onFalse: e.target.value })}
                                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                                  >
                                    <option value="">-- [Fin del Flujo] --</option>
                                    {workflowSteps
                                      .filter(s => s.id !== step.id)
                                      .map(s => (
                                        <option key={s.id} value={s.id}>{s.id} ({s.type})</option>
                                      ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                          ) : step.type === 'parallel' ? (
                            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4 font-sans">
                              <span className="text-[11px] font-bold text-slate-400 block">Ramas Paralelas</span>
                              <div>
                                <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-sans">Join Step ID (Nodo de unión final)</label>
                                <input
                                  type="text"
                                  placeholder="transform_final"
                                  value={step.config?.joinNextStepId || ''}
                                  onChange={e => handleUpdateStepConfig(step.id, { joinNextStepId: e.target.value })}
                                  className="w-full bg-slate-955 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                                />
                                <p className="text-[10px] text-slate-500 mt-1 font-sans">Paso que se ejecuta una vez que finalizan todas las ramas.</p>
                              </div>
                              <div className="space-y-2">
                                <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-sans">Ramas Conectadas (nextStepIds)</label>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                  {step.nextStepIds.length > 0 ? step.nextStepIds.map(id => (
                                    <span key={id} className="inline-flex items-center gap-1 font-mono text-[11px] bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-emerald-450">
                                      {id}
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateStep(step.id, { nextStepIds: step.nextStepIds.filter(x => x !== id) })}
                                        className="text-slate-500 hover:text-rose-400 font-bold"
                                        title="Remove branch"
                                      >
                                        ×
                                      </button>
                                    </span>
                                  )) : (
                                    <span className="text-xs text-slate-500 font-mono italic">No hay ramas conectadas</span>
                                  )}
                                </div>
                                <select
                                  value=""
                                  onChange={e => {
                                    const targetId = e.target.value;
                                    if (targetId && !step.nextStepIds.includes(targetId)) {
                                      handleUpdateStep(step.id, { nextStepIds: [...step.nextStepIds, targetId] });
                                    }
                                  }}
                                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                                >
                                  <option value="">-- Conectar nueva rama --</option>
                                  {workflowSteps
                                    .filter(s => s.id !== step.id && !step.nextStepIds.includes(s.id))
                                    .map(s => (
                                      <option key={s.id} value={s.id}>{s.id} ({s.type})</option>
                                    ))}
                                </select>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 font-sans">
                              <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-sans">Siguiente Paso (nextStepIds)</label>
                              <select
                                value={step.nextStepIds[0] || ''}
                                onChange={e => {
                                  const targetId = e.target.value;
                                  handleUpdateStep(step.id, {
                                    nextStepIds: targetId ? [targetId] : []
                                  });
                                }}
                                className="w-full bg-slate-955 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                              >
                                <option value="">-- [Fin del Flujo] --</option>
                                {workflowSteps
                                  .filter(s => s.id !== step.id)
                                  .map(s => (
                                    <option key={s.id} value={s.id}>{s.id} ({s.type})</option>
                                  ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Inputs and Reference Variables Tab */}
                      {inspectorTab === 'inputs' && (
                        <div className="space-y-6">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block font-sans">
                            Referencias y Variables de Entrada
                          </span>

                          {/* Step preceding output reference mapping */}
                          <PrecedingStepInspectorView 
                            workflowSteps={workflowSteps}
                            selectedStepId={step.id}
                            onCopy={(text) => onShowNotification(`Copiado: ${text}`, 'success')}
                          />

                          {/* Context Variable Copier Panel */}
                          <div className="pt-4 border-t border-slate-800 space-y-3 font-sans">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                              Copiador de Variables de Contexto
                            </span>
                            <p className="text-[11px] text-slate-400 leading-normal">
                              Haz clic en el botón de copiar para obtener la expresión de plantilla correspondiente del paso previo y pegarla en los campos de configuración.
                            </p>
                            
                            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                              {(() => {
                                const stepsBefore = getStepsBefore(step.id);
                                if (stepsBefore.length === 0) {
                                  return (
                                    <div className="text-xs text-slate-500 italic bg-slate-900 p-3 rounded border border-slate-800">
                                      No hay pasos anteriores en este flujo.
                                    </div>
                                  );
                                }
                                
                                return stepsBefore.map(prevStep => {
                                  const templates: string[] = [];
                                  if (prevStep.type === 'trigger') {
                                    templates.push('{{context.triggerPayload.message}}');
                                    templates.push('{{context.triggerPayload.triggeredBy}}');
                                  } else if (prevStep.type === 'normalizer') {
                                    templates.push(`{{context.stepOutputs.${prevStep.id}.message}}`);
                                  } else if (prevStep.type === 'agent') {
                                    templates.push(`{{context.stepOutputs.${prevStep.id}.output}}`);
                                    templates.push(`{{context.stepOutputs.${prevStep.id}.success}}`);
                                  } else if (prevStep.type === 'shell_test') {
                                    templates.push(`{{context.stepOutputs.${prevStep.id}.stdout}}`);
                                    templates.push(`{{context.stepOutputs.${prevStep.id}.code}}`);
                                  } else if (prevStep.type === 'transform') {
                                    templates.push(`{{context.stepOutputs.${prevStep.id}.outputText}}`);
                                  } else {
                                    templates.push(`{{context.stepOutputs.${prevStep.id}.output}}`);
                                  }

                                  return (
                                    <div key={prevStep.id} className="bg-slate-900 border border-slate-800 p-2.5 rounded-lg space-y-1.5">
                                      <div className="flex justify-between items-center">
                                        <span className="text-[11px] font-bold text-slate-300 font-mono">{prevStep.id}</span>
                                        <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">{prevStep.type}</span>
                                      </div>
                                      <div className="space-y-1">
                                        {templates.map(tpl => (
                                          <div key={tpl} className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 px-2 py-1 rounded text-[10px] font-mono text-slate-200">
                                            <span className="truncate select-all flex-1 pr-1">{tpl}</span>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                navigator.clipboard.writeText(tpl);
                                                onShowNotification(`Copiado: ${tpl}`, 'success');
                                              }}
                                              className="text-slate-400 hover:text-emerald-400 p-0.5 hover:bg-slate-900 rounded transition border border-slate-800 shrink-0"
                                              title="Copy template"
                                            >
                                              <Copy className="h-3.5 w-3.5" />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
            </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 py-20 font-sans">
                <Sliders className="h-10 w-10 mb-3 opacity-20 text-slate-400" />
                <p className="text-sm font-semibold">Inspector Panel</p>
                <p className="text-xs text-slate-600 mt-1 max-w-[250px]">Click any step card in the flow designer list on the left to configure its properties.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Validation Error Modal */}
      {isErrorModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-rose-500/40 rounded-xl max-w-md w-full shadow-2xl p-6 relative overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 to-red-600"></div>
            
            <div className="flex items-start gap-4">
              <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-slate-100 font-sans">No se puede guardar el Workflow</h3>
                <p className="text-xs text-slate-500 mt-1 font-sans">Corrige los siguientes problemas antes de continuar:</p>
                
                 <ul className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                   {validationErrors.map((err, idx) => {
                     const match = err.match(/^Paso "([^"]+)":/);
                     const target = match && workflowSteps.find(step => (step.config?.name || step.id) === match[1]);
                     return <li key={idx} className="text-xs text-rose-300 bg-rose-500/5 border border-rose-500/10 rounded p-2 flex items-start gap-2 font-sans">
                       <span className="text-rose-500 select-none">•</span>
                       {target ? <button type="button" className="text-left hover:text-white underline decoration-rose-500/40 underline-offset-2" onClick={() => { setSelectedStepId(target.id); setIsErrorModalOpen(false); }}>{err}</button> : <span>{err}</span>}
                     </li>;
                   })}
                 </ul>
                 {validationWarnings.length > 0 && (
                   <div className="mt-4 rounded border border-amber-500/20 bg-amber-500/5 p-3">
                     <p className="text-xs font-semibold text-amber-300">Advertencias que no bloquean el guardado</p>
                     <ul className="mt-2 space-y-1">
                       {validationWarnings.map((warning, index) => <li key={`${warning.stepId || 'workflow'}-${index}`} className="text-xs text-amber-200/80">{warning.stepId ? `Paso "${warning.stepId}": ` : ''}{warning.message}</li>)}
                     </ul>
                   </div>
                 )}
              </div>
            </div>
            
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setIsErrorModalOpen(false)}
                className="bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 px-4 py-2 rounded text-xs font-semibold transition"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template selector modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm" onClick={() => setShowTemplateModal(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-emerald-400" /> Comenzar desde plantilla
                </h3>
                <p className="text-xs text-slate-500 mt-1">Elegí un punto de partida. Después podés editar cada paso y guardar tu workflow.</p>
              </div>
              <button onClick={() => setShowTemplateModal(false)} className="text-slate-400 hover:text-slate-100 text-2xl leading-none font-semibold">&times;</button>
            </div>
            <div className="p-6 space-y-3">
               {START_TEMPLATES.map(tpl => (
                <button
                  key={tpl.id}
                  onClick={() => handleApplyTemplate(tpl.id)}
                  className="w-full text-left bg-slate-950 hover:bg-emerald-500/5 border border-slate-800 hover:border-emerald-500/40 rounded-xl p-4 transition group"
                >
                  <span className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <Play className="h-4 w-4 text-emerald-400 group-hover:fill-emerald-400" />
                    {tpl.name}
                  </span>
                   <span className="text-xs text-slate-500 mt-1 block">{tpl.description}</span>
                   <span className="flex flex-wrap items-center gap-1.5 mt-3">
                     {tpl.category && <span className="text-[10px] text-slate-400 border border-slate-700 rounded px-1.5 py-0.5">{tpl.category}</span>}
                     {tpl.difficulty && <span className={`text-[10px] border rounded px-1.5 py-0.5 ${tpl.difficulty === 'Avanzado' ? 'text-rose-300 border-rose-500/30' : 'text-emerald-300 border-emerald-500/30'}`}>{tpl.difficulty}</span>}
                     {tpl.stepCount && <span className="text-[10px] text-slate-500">{tpl.stepCount} pasos</span>}
                     {tpl.tags?.map(tag => <span key={tag} className="text-[10px] text-slate-500">#{tag}</span>)}
                   </span>
                 </button>
              ))}
              <button
                onClick={handleCreateEmptyWorkflow}
                className="w-full text-left bg-slate-900 hover:bg-slate-800 border border-dashed border-slate-700 rounded-xl p-4 transition"
              >
                <span className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <Boxes className="h-4 w-4 text-slate-400" /> Empezar vacía
                </span>
                <span className="text-xs text-slate-500 mt-1 block">Construí tu pipeline desde cero, sin pasos precargados.</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step catalog modal */}
      <StepCatalogModal
        isOpen={isCatalogModalOpen}
        onClose={() => {
          setIsCatalogModalOpen(false);
          setInsertBetweenContext(null);
        }}
        onSelect={handleSelectStepFromCatalog}
       />

       {pendingTemplateId && (
         <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="replace-template-title">
           <div className="w-full max-w-md rounded-xl border border-amber-500/30 bg-slate-900 p-6 shadow-2xl">
             <div className="flex items-start gap-3">
               <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
               <div>
                 <h3 id="replace-template-title" className="text-base font-semibold text-slate-100">¿Reemplazar el pipeline actual?</h3>
                 <p className="mt-2 text-xs leading-relaxed text-slate-400">La plantilla reemplazará los {workflowSteps.length} pasos y descartará los cambios sin guardar. Esta acción no modifica ningún workflow guardado hasta que confirmes.</p>
               </div>
             </div>
             <div className="mt-5 flex justify-end gap-2">
               <button type="button" onClick={() => setPendingTemplateId(null)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancelar</button>
               <button type="button" onClick={() => applyTemplate(pendingTemplateId)} className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25">Reemplazar plantilla</button>
             </div>
           </div>
         </div>
       )}

     </div>
  );
};
