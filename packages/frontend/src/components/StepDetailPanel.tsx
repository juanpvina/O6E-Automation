import React, { useState, useEffect } from 'react';
import { Clock, Terminal, X, Cpu, FileCode, Play, Save } from 'lucide-react';
import { Execution, WorkflowStep, Workflow, PROVIDER_MODELS } from '@opencode/shared';
import { formatDuration, getLogsForStep, getStepDisplayName, validateCronExpression } from '../lib/helpers';
import { LogEntry } from '../hooks/useExecutionStream';
import { AgentResponse } from './AgentResponse';
import { ReadonlyJson } from './ReadonlyJson';
import { StatusBadge, StepStatus } from './StatusBadge';
import { CRON_PRESETS, TIMEZONE_OPTIONS } from '../lib/constants';

export type StepStatusMap = Record<string, StepStatus>;

interface VariableHelperProps {
  workflow?: Workflow | null;
  currentStepId: string;
  onSelect: (variable: string) => void;
}
export const VariableHelper: React.FC<VariableHelperProps> = ({ workflow, currentStepId, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);
  if (!workflow) return null;
  
  // Find preceding steps
  const steps = workflow.steps;
  const currentIndex = steps.findIndex(s => s.id === currentStepId);
  const precedingSteps = currentIndex > 0 ? steps.slice(0, currentIndex) : [];

  return (
    <div className="relative inline-block text-left mt-1">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-[10px] text-emerald-400 hover:text-emerald-300 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 transition font-semibold"
      >
        {isOpen ? 'Cerrar variables' : 'Insertar variable...'}
      </button>
      {isOpen && (
        <div className="absolute left-0 mt-1 w-64 bg-slate-900 border border-slate-800 rounded-md shadow-lg z-50 max-h-48 overflow-y-auto p-1 text-[11px] font-mono">
          <div className="px-2 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-850">Variables del Flujo</div>
          <button
            type="button"
            onClick={() => {
              onSelect('{{context.triggerPayload}}');
              setIsOpen(false);
            }}
            className="w-full text-left px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition truncate"
          >
            Payload del Disparador
          </button>
          {precedingSteps.length === 0 ? (
            <div className="px-2 py-1 text-[10px] text-slate-500 italic">No hay otros nodos previos.</div>
          ) : (
            precedingSteps.map(s => {
              const label = s.config?.name || s.id;
              return (
                <div key={s.id} className="border-t border-slate-850 mt-1 pt-1">
                  <span className="px-2 text-[9px] text-slate-500 font-sans font-bold uppercase">{label} ({s.type})</span>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(`{{context.stepOutputs.${s.id}}}`);
                      setIsOpen(false);
                    }}
                    className="w-full text-left px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition truncate"
                  >
                    Salida completa
                  </button>
                  {s.type === 'agent' && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(`{{context.stepOutputs.${s.id}.output}}`);
                        setIsOpen(false);
                      }}
                      className="w-full text-left px-3 py-1 text-slate-400 hover:bg-slate-800 hover:text-white rounded transition truncate"
                    >
                      .output (Texto)
                    </button>
                  )}
                  {s.type === 'transform' && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(`{{context.stepOutputs.${s.id}.outputText}}`);
                        setIsOpen(false);
                      }}
                      className="w-full text-left px-3 py-1 text-slate-400 hover:bg-slate-800 hover:text-white rounded transition truncate"
                    >
                      .outputText (Formateado)
                    </button>
                  )}
                  {s.type === 'shell_test' && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(`{{context.stepOutputs.${s.id}.stdout}}`);
                        setIsOpen(false);
                      }}
                      className="w-full text-left px-3 py-1 text-slate-400 hover:bg-slate-800 hover:text-white rounded transition truncate"
                    >
                      .stdout (Consola)
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

interface StepDetailPanelProps {
  step: WorkflowStep;
  execution: Execution;
  workflow?: Workflow | null;
  stepStatuses: StepStatusMap;
  logs: LogEntry[];
  onClose: () => void;
  onFetchData?: () => void;
}

const levelClass = (level: string): string => {
  if (level === 'error') return 'bg-rose-500/15 text-rose-400';
  if (level === 'warn') return 'bg-amber-500/15 text-amber-400';
  return 'bg-emerald-500/15 text-emerald-400';
};

export const StepDetailPanel: React.FC<StepDetailPanelProps> = ({
  step,
  execution,
  workflow,
  stepStatuses,
  logs,
  onClose,
  onFetchData
}) => {
  const status = stepStatuses[step.id] || 'pending';
  const timing = execution.stepTimings?.find(t => t.stepId === step.id);
  const output = execution.stepOutputs?.[step.id];
  const metrics = execution.agentMetrics?.[step.id];
  const stepLogs = getLogsForStep(step.id, logs, execution.stepTimings);
  const config = step.config ?? {};

  const [activeTab, setActiveTab] = useState<'flujo' | 'config' | 'logs'>('flujo');

  const [editModel, setEditModel] = useState<string>('');
  const [editPrompt, setEditPrompt] = useState<string>('');
  const [editCommand, setEditCommand] = useState<string>('');
  const [editJsonConfig, setEditJsonConfig] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // States for http_request editing
  const [editUrl, setEditUrl] = useState<string>('');
  const [editMethod, setEditMethod] = useState<string>('GET');
  const [editHeaders, setEditHeaders] = useState<string>('{}');
  const [editBody, setEditBody] = useState<string>('');
  const [editAuthType, setEditAuthType] = useState<string>('none');
  const [editBearerToken, setEditBearerToken] = useState<string>('');

  // States for code editing
  const [editLanguage, setEditLanguage] = useState<'javascript' | 'python'>('javascript');
  const [editCode, setEditCode] = useState<string>('');
  const [editCodeSource, setEditCodeSource] = useState<'inline' | 'file'>('inline');
  const [editPythonFile, setEditPythonFile] = useState<string>('');
  const [editPythonArgs, setEditPythonArgs] = useState<string>('');
  const [editPythonTimeout, setEditPythonTimeout] = useState<string>('30000');

  // States for dedicated JSON parser editing
  const [editJsonInputExpr, setEditJsonInputExpr] = useState<string>('');
  const [editJsonOperation, setEditJsonOperation] = useState<string>('parse');
  const [editJsonPath, setEditJsonPath] = useState<string>('');
  const [editJsonRowsPath, setEditJsonRowsPath] = useState<string>('');
  const [editJsonMapping, setEditJsonMapping] = useState<string>('{}');

  // States for trigger editing
  const [editTriggerType, setEditTriggerType] = useState<string>('webhook');
  const [editCronExpression, setEditCronExpression] = useState<string>('0 9 * * 1-5');
  const [editTimezone, setEditTimezone] = useState<string>('America/Bogota');
  const [editCronMinute, setEditCronMinute] = useState<string>('0');
  const [editCronHour, setEditCronHour] = useState<string>('9');
  const [editCronFrequency, setEditCronFrequency] = useState<string>('daily');

  // States for discord_notify editing
  const [editDiscordWebhookUrl, setEditDiscordWebhookUrl] = useState<string>('');
  const [editDiscordMessage, setEditDiscordMessage] = useState<string>('');

  // States for google_sheets editing
  const [editSheetsSpreadsheetId, setEditSheetsSpreadsheetId] = useState<string>('');
  const [editSheetsRange, setEditSheetsRange] = useState<string>('');
  const [editSheetsOperation, setEditSheetsOperation] = useState<string>('append');
  const [editSheetsValues, setEditSheetsValues] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [rewinding, setRewinding] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Auto-adjust active tab when selecting a new node based on its completion state (only when step ID changes)
  useEffect(() => {
    setActiveTab('flujo');
    setStatusMessage(null);
  }, [step.id]);

  // Load configuration values when the step config updates
  useEffect(() => {
    if (step.type === 'trigger') {
      setEditTriggerType(step.config?.triggerType || 'webhook');
      setEditCronExpression(step.config?.cronExpression || '0 9 * * 1-5');
      setEditTimezone(step.config?.timezone || 'America/Bogota');
      setEditCronMinute(step.config?.cronMinute !== undefined ? String(step.config.cronMinute) : '0');
      setEditCronHour(step.config?.cronHour !== undefined ? String(step.config.cronHour) : '9');
      setEditCronFrequency(step.config?.cronFrequency || 'daily');
    } else if (step.type === 'discord_notify') {
      setEditDiscordWebhookUrl(step.config?.webhookUrl || '');
      setEditDiscordMessage(step.config?.message || '');
    } else if (step.type === 'google_sheets') {
      setEditSheetsSpreadsheetId(step.config?.spreadsheetId || '');
      setEditSheetsRange(step.config?.range || '');
      setEditSheetsOperation(step.config?.operation || 'append');
      setEditSheetsValues(typeof step.config?.values === 'string' ? step.config.values : JSON.stringify(step.config?.values || '', null, 2));
    } else if (step.type === 'agent') {
      setEditModel(step.config?.model || '');
      setEditPrompt(step.config?.prompt || '');
    } else if (step.type === 'shell_test') {
      setEditCommand(step.config?.command || '');
    } else if (step.type === 'http_request') {
      setEditUrl(step.config?.url || '');
      setEditMethod(step.config?.method || 'GET');
      setEditHeaders(JSON.stringify(step.config?.headers || {}, null, 2));
      setEditBody(step.config?.body || '');
      setEditAuthType(step.config?.authType || 'none');
      setEditBearerToken(step.config?.bearerToken || '');
    } else if (step.type === 'code') {
      setEditLanguage(step.config?.language || 'javascript');
      setEditCode(step.config?.code || '');
      setEditCodeSource(step.config?.source === 'file' ? 'file' : 'inline');
      setEditPythonFile(step.config?.filePath || '');
       setEditPythonArgs(Array.isArray(step.config?.args) ? JSON.stringify(step.config.args) : String(step.config?.args || ''));
      setEditPythonTimeout(String(step.config?.timeoutMs ?? 30000));
    } else if (step.type === 'python') {
      setEditCode(step.config?.code || '');
      setEditCodeSource(step.config?.source === 'file' ? 'file' : 'inline');
      setEditPythonFile(step.config?.filePath || '');
       setEditPythonArgs(Array.isArray(step.config?.args) ? JSON.stringify(step.config.args) : String(step.config?.args || ''));
      setEditPythonTimeout(String(step.config?.timeoutMs ?? 30000));
    } else if (step.type === 'json_parser') {
      setEditJsonInputExpr(step.config?.inputExpr || 'context.triggerPayload');
      setEditJsonOperation(step.config?.operation || 'parse');
      setEditJsonPath(step.config?.path || '');
      setEditJsonRowsPath(step.config?.rowsPath || '');
      setEditJsonMapping(JSON.stringify(step.config?.mapping || {}, null, 2));
    } else {
      setEditJsonConfig(JSON.stringify(step.config || {}, null, 2));
      setJsonError(null);
    }
  }, [step.id, step.type, step.config]);

  const handleJsonChange = (val: string) => {
    setEditJsonConfig(val);
    try {
      JSON.parse(val);
      setJsonError(null);
    } catch (e: any) {
      setJsonError(e.message);
    }
  };

  const handleSaveWorkflow = async () => {
    if (!workflow) {
      setStatusMessage({ text: 'No hay un workflow asociado a esta ejecución.', type: 'error' });
      return;
    }

    setSaving(true);
    setStatusMessage(null);

    const failValidation = (text: string) => {
      setStatusMessage({ text, type: 'error' });
      setSaving(false);
    };
    if (step.type === 'python' || (step.type === 'code' && editLanguage === 'python')) {
      if (editCodeSource === 'inline' && !editCode.trim()) return failValidation('El código Python inline es obligatorio.');
      if (editCodeSource === 'file' && (!editPythonFile.trim() || editPythonFile.includes('..') || /^(?:[A-Za-z]:[\\/]|[\\/])/.test(editPythonFile.trim()))) return failValidation('La ruta Python debe ser relativa y estar dentro del proyecto.');
      const timeout = Number(editPythonTimeout);
      if (!Number.isFinite(timeout) || timeout < 1 || timeout > 300000) return failValidation('El timeout Python debe estar entre 1 y 300000 ms.');
    }
    if (step.type === 'code' && editLanguage === 'javascript' && !editCode.trim()) return failValidation('El código JavaScript es obligatorio.');
    if (step.type === 'json_parser' && !editJsonInputExpr.trim()) return failValidation('La expresión de entrada del JSON Parser es obligatoria.');
    if (step.type === 'http_request') {
      try {
        const url = new URL(editUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        return failValidation('La URL HTTP debe ser válida y usar http o https.');
      }
      try {
        const headers = JSON.parse(editHeaders);
        if (!headers || Array.isArray(headers) || typeof headers !== 'object') throw new Error();
      } catch {
        return failValidation('Las cabeceras HTTP deben ser un objeto JSON válido.');
      }
    }

    let updatedConfig: Record<string, any> = {};
    if (step.type === 'trigger') {
      const isCron = editTriggerType === 'cron';
      updatedConfig = {
        ...step.config,
        triggerType: editTriggerType,
        cronExpression: isCron ? editCronExpression : undefined,
        timezone: isCron ? editTimezone : undefined,
        cronMinute: isCron ? (editCronMinute === '' ? undefined : Number(editCronMinute)) : undefined,
        cronHour: isCron ? (editCronHour === '' ? undefined : Number(editCronHour)) : undefined,
        cronFrequency: isCron ? editCronFrequency : undefined
      };
    } else if (step.type === 'discord_notify') {
      updatedConfig = {
        ...step.config,
        webhookUrl: editDiscordWebhookUrl,
        message: editDiscordMessage
      };
    } else if (step.type === 'google_sheets') {
      let parsedValues = editSheetsValues;
      if (editSheetsValues.trim().startsWith('[') || editSheetsValues.trim().startsWith('{')) {
        try {
          parsedValues = JSON.parse(editSheetsValues);
        } catch (e) {
          // Keep as string if it fails to parse
        }
      }
      updatedConfig = {
        ...step.config,
        spreadsheetId: editSheetsSpreadsheetId,
        range: editSheetsRange,
        operation: editSheetsOperation,
        values: parsedValues
      };
    } else if (step.type === 'agent') {
      updatedConfig = {
        ...step.config,
        model: editModel,
        prompt: editPrompt
      };
    } else if (step.type === 'shell_test') {
      updatedConfig = {
        ...step.config,
        command: editCommand
      };
    } else if (step.type === 'http_request') {
      let parsedHeaders = {};
      try {
        parsedHeaders = JSON.parse(editHeaders);
      } catch (e: any) {
        setStatusMessage({ text: `Cabeceras JSON inválido: ${e.message}`, type: 'error' });
        setSaving(false);
        return;
      }
      updatedConfig = {
        ...step.config,
        url: editUrl,
        method: editMethod,
        headers: parsedHeaders,
        body: editBody,
        authType: editAuthType,
        bearerToken: editBearerToken
      };
    } else if (step.type === 'code') {
      let parsedArgs: any[] = [];
      try {
        const parsed = editPythonArgs.trim() ? JSON.parse(editPythonArgs) : [];
        if (!Array.isArray(parsed) || parsed.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) {
          throw new Error('Los argumentos Python deben ser un array JSON de strings o números.');
        }
        parsedArgs = parsed.map(String);
      } catch (e: any) {
        setStatusMessage({ text: `Argumentos Python inválidos: ${e.message}`, type: 'error' });
        setSaving(false);
        return;
      }
      updatedConfig = {
        ...step.config,
        language: editLanguage,
        code: editCode,
        source: editLanguage === 'python' ? editCodeSource : 'inline',
        filePath: editLanguage === 'python' && editCodeSource === 'file' ? editPythonFile : undefined,
        args: parsedArgs,
        timeoutMs: Number(editPythonTimeout) || 30000
      };
    } else if (step.type === 'python') {
      let parsedArgs: any[];
      try {
        const parsed = editPythonArgs.trim() ? JSON.parse(editPythonArgs) : [];
        if (!Array.isArray(parsed) || parsed.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) {
          throw new Error('Los argumentos Python deben ser un array JSON de strings o números.');
        }
        parsedArgs = parsed.map(String);
      } catch (e: any) {
        setStatusMessage({ text: `Argumentos Python inválidos: ${e.message}`, type: 'error' });
        setSaving(false);
        return;
      }
      updatedConfig = {
        ...step.config,
        source: editCodeSource,
        code: editCodeSource === 'inline' ? editCode : '',
        filePath: editCodeSource === 'file' ? editPythonFile : undefined,
        args: parsedArgs,
        timeoutMs: Number(editPythonTimeout) || 30000
      };
    } else if (step.type === 'json_parser') {
      let mapping: Record<string, any>;
      try {
        mapping = JSON.parse(editJsonMapping || '{}');
        if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object') throw new Error('El mapping debe ser un objeto JSON.');
      } catch (e: any) {
        setStatusMessage({ text: `Mapping JSON inválido: ${e.message}`, type: 'error' });
        setSaving(false);
        return;
      }
      updatedConfig = {
        ...step.config,
        inputExpr: editJsonInputExpr,
        operation: editJsonOperation,
        path: editJsonPath,
        rowsPath: editJsonRowsPath,
        mapping
      };
    } else {
      try {
        updatedConfig = JSON.parse(editJsonConfig);
      } catch (e: any) {
        setStatusMessage({ text: `JSON inválido: ${e.message}`, type: 'error' });
        setSaving(false);
        return;
      }
    }

    const updatedSteps = workflow.steps.map(s => {
      if (s.id === step.id) {
        return {
          ...s,
          config: updatedConfig
        };
      }
      return s;
    });

    const updatedWorkflow: Workflow = {
      ...workflow,
      steps: updatedSteps
    };

    try {
      const res = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedWorkflow)
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Error al guardar los cambios en el servidor');
      }

      setStatusMessage({ text: '¡Cambios guardados con éxito en el workflow!', type: 'success' });
      if (onFetchData) {
        onFetchData();
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Error de red al guardar los cambios', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleRewind = async () => {
    setRewinding(true);
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/executions/${execution.id}/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId: step.id })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Error al re-ejecutar desde este nodo');
      }

      setStatusMessage({ text: '¡Re-ejecución iniciada con éxito!', type: 'success' });
      if (onFetchData) {
        onFetchData();
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Error de red al re-ejecutar', type: 'error' });
    } finally {
      setRewinding(false);
    }
  };

  // Trace preceding steps to display input data (Fase v2)
  const precedingSteps = workflow
    ? workflow.steps.filter(s => {
        if (s.type === 'condition') {
          return s.config?.onTrue === step.id || s.config?.onFalse === step.id;
        }
        return s.nextStepIds.includes(step.id);
      })
    : [];

  const renderPrecedingOutputs = () => {
    if (precedingSteps.length === 0) {
      return (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 text-center">
          <span className="text-xs text-slate-500 block font-sans">
            Este es un paso inicial (Trigger) del flujo. No tiene nodos anteriores que le envíen datos.
          </span>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {precedingSteps.map(ps => {
          const psOutput = execution.stepOutputs?.[ps.id];
          return (
            <div key={ps.id} className="space-y-2 bg-slate-900/40 border border-slate-800/80 rounded-lg p-3">
              <div className="flex justify-between items-center border-b border-slate-800/60 pb-1.5">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 font-sans block">Nodo anterior</span>
                  <span className="text-xs font-bold text-slate-200 font-mono">
                    {ps.config?.name || ps.id} <span className="text-[10px] text-slate-500 font-sans">({ps.type})</span>
                  </span>
                </div>
                <StatusBadge status={stepStatuses[ps.id] || 'pending'} />
              </div>
              <div className="max-h-60 overflow-y-auto">
                {psOutput === undefined ? (
                  <span className="text-slate-500 text-xs italic block py-2">El nodo anterior no produjo salidas o aún no se ejecutó.</span>
                ) : typeof psOutput === 'string' ? (
                  <pre className="text-[11px] font-mono text-slate-300 bg-slate-950/80 p-2 rounded border border-slate-800/80 overflow-x-auto whitespace-pre-wrap break-all">
                    {psOutput}
                  </pre>
                ) : (
                  <div className="bg-slate-950/80 p-1.5 rounded border border-slate-800/80">
                    <ReadonlyJson data={psOutput} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderCurrentNodeInfo = () => {
    return (
      <div className="space-y-4 font-sans text-xs text-slate-300">
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-y-3 gap-x-4 border-b border-slate-800/60 pb-3">
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-bold block font-mono">ID Técnico</span>
              <span className="font-mono text-slate-200 font-semibold select-all">{step.id}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-bold block font-mono">Tipo de Paso</span>
              <span className="font-mono text-emerald-400 font-bold">{step.type.toUpperCase()}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-y-3 gap-x-4 border-b border-slate-800/60 pb-3">
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-bold block font-mono">Estado Actual</span>
              <div className="mt-1">
                <StatusBadge status={status} />
              </div>
            </div>
            <div>
              <span className="text-[10px] text-slate-555 uppercase font-bold block font-mono">Duración</span>
              <span className="text-slate-200 font-semibold flex items-center gap-1 mt-0.5 font-mono">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                {timing ? formatDuration(timing.durationMs) : 'N/A'}
              </span>
            </div>
          </div>

          {timing && (
            <div className="grid grid-cols-1 gap-y-1">
              <span className="text-[10px] text-slate-500 uppercase font-bold block font-mono">Iniciado en</span>
              <span className="font-mono text-[11px] text-slate-300">
                {new Date(timing.startedAt).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* Action routing info */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-lg p-4 space-y-2">
          <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1 font-mono">Destinos siguientes (Ruteo)</span>
          {step.type === 'condition' ? (
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-bold bg-emerald-950/65 px-1.5 py-0.5 rounded text-[9px]">IF TRUE</span>
                <span className="text-slate-300">{step.config?.onTrue || 'Finalizar flujo'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-rose-400 font-bold bg-rose-950/65 px-1.5 py-0.5 rounded text-[9px]">IF FALSE</span>
                <span className="text-slate-300">{step.config?.onFalse || 'Finalizar flujo'}</span>
              </div>
            </div>
          ) : (
            <div className="font-mono text-[11px]">
              {step.nextStepIds.length > 0 ? (
                <div className="flex items-center gap-1.5 text-slate-300">
                  <span>Apunta a:</span>
                  {step.nextStepIds.map(nid => (
                    <span key={nid} className="bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800/80 text-slate-200">
                      {nid}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-slate-500 italic">Fin del pipeline (Último nodo).</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderStepConfig = () => {
    const cleanLabel = (key: string): string => {
      const dict: Record<string, string> = {
        name: 'Nombre legible',
        projectId: 'Proyecto destino',
        agent: 'Rol del Agente',
        provider: 'Proveedor de IA',
        model: 'Modelo utilizado',
        prompt: 'Instrucciones del Prompt',
        expression: 'Expresión condicional',
        command: 'Comando de consola',
        triggerType: 'Tipo de disparador',
        cronExpression: 'Expresión Cron',
        action: 'Acción Git',
        commitMessage: 'Mensaje de commit',
        title: 'Título del PR',
        description: 'Descripción',
        baseBranch: 'Rama base',
        body: 'Cuerpo del mensaje',
        url: 'URL destino',
        method: 'Método HTTP',
        headers: 'Cabeceras HTTP',
        timeoutMs: 'Timeout (ms)',
        maxRetries: 'Intentos máximos'
      };
      return dict[key] || key;
    };

    if (Object.keys(config).length === 0) {
      return (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-md p-4 text-center">
          <span className="text-slate-500 text-xs">Este paso no requiere configuración adicional.</span>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-lg p-3 space-y-3.5">
          {Object.entries(config).map(([key, val]) => {
            if (key === 'name') return null; // skip, already in header
            const friendlyName = cleanLabel(key);
            
            if (key === 'prompt' || key === 'expression' || key === 'description') {
              return (
                <div key={key} className="space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase font-bold block font-mono">{friendlyName}</span>
                  <pre className="text-[11px] font-mono text-slate-300 bg-slate-950/80 p-2.5 rounded border border-slate-800/80 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                    {String(val)}
                  </pre>
                </div>
              );
            }

            let formattedVal: React.ReactNode;
            if (typeof val === 'object' && val !== null) {
              formattedVal = (
                <div className="bg-slate-950/80 p-1.5 rounded border border-slate-800/80 mt-1 max-h-32 overflow-y-auto">
                  <ReadonlyJson data={val} />
                </div>
              );
            } else if (typeof val === 'boolean') {
              formattedVal = (
                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold mt-0.5 ${val ? 'bg-emerald-950/65 text-emerald-400 border border-emerald-500/20' : 'bg-slate-950/80 text-slate-500 border border-slate-800/80'}`}>
                  {val ? 'Habilitado (Sí)' : 'Deshabilitado (No)'}
                </span>
              );
            } else {
              formattedVal = (
                <span className="font-mono text-slate-200 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800/80 text-[11px]">
                  {String(val)}
                </span>
              );
            }

            return (
              <div key={key} className="space-y-1">
                <span className="text-[10px] text-slate-500 uppercase font-bold block font-mono">{friendlyName}</span>
                {formattedVal}
              </div>
            );
          })}
        </div>

        <div className="border-t border-slate-800/60 pt-3">
          <details className="group">
            <summary className="text-[10px] text-slate-500 uppercase font-bold cursor-pointer select-none hover:text-slate-400 transition flex items-center gap-1.5 font-sans">
              <span>Avanzado: ver JSON de configuración crudo</span>
            </summary>
            <div className="mt-2 bg-slate-900/40 border border-slate-800/80 rounded-md p-2 overflow-x-auto max-h-44 overflow-y-auto">
              <ReadonlyJson data={config} />
            </div>
          </details>
        </div>
      </div>
    );
  };

  const renderConfigTab = () => {
    return (
      <div className="space-y-4 font-sans text-xs text-slate-300">
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-4">
          <div className="flex justify-between items-center border-b border-slate-800/60 pb-2">
          <h4 className="font-bold text-slate-200">Editar Configuración (En Caliente)</h4>
            <span className="text-[10px] uppercase font-bold text-slate-500 font-mono">
              Paso: {step.id}
            </span>
          </div>

          {step.type === 'code' && <p className="text-[10px] text-slate-500">Code es el nodo multipropósito para JavaScript o Python inline. Python Script está enfocado en ejecución Python con archivo, argumentos y timeout.</p>}
          {step.type === 'python' && <p className="text-[10px] text-amber-300/70">Python Script ejecuta únicamente Python 3, inline o desde un archivo relativo del proyecto.</p>}

          {step.type === 'agent' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Modelo de IA
                </label>
                <select
                  value={editModel}
                  onChange={(e) => setEditModel(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="">Selecciona un modelo...</option>
                  {Object.entries(PROVIDER_MODELS).map(([provider, models]) => (
                    <optgroup key={provider} label={provider.toUpperCase()}>
                      {models.map((modelName) => (
                        <option key={modelName} value={modelName}>
                          {modelName}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Prompt
                </label>
                <textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  rows={8}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500 resize-y"
                  placeholder="Instrucciones del Prompt..."
                />
                <VariableHelper workflow={workflow} currentStepId={step.id} onSelect={(val) => setEditPrompt(p => p + val)} />
              </div>
            </div>
          ) : step.type === 'shell_test' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Comando de Consola
                </label>
                <textarea
                  value={editCommand}
                  onChange={(e) => setEditCommand(e.target.value)}
                  rows={6}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500 resize-y"
                  placeholder="Comando a ejecutar (ej: npm run test)..."
                />
                <VariableHelper workflow={workflow} currentStepId={step.id} onSelect={(val) => setEditCommand(p => p + val)} />
              </div>
            </div>
          ) : step.type === 'http_request' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Método HTTP
                </label>
                <select
                  value={editMethod}
                  onChange={(e) => setEditMethod(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  URL Destino
                </label>
                <input
                  type="text"
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  placeholder="https://api.example.com/endpoint"
                />
                <VariableHelper workflow={workflow} currentStepId={step.id} onSelect={(val) => setEditUrl(p => p + val)} />
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Cabeceras (JSON)
                </label>
                <textarea
                  value={editHeaders}
                  onChange={(e) => setEditHeaders(e.target.value)}
                  rows={4}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500 resize-y"
                  placeholder='{"Authorization": "Bearer {{secrets.token}}"}'
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Cuerpo de Petición (Body)
                </label>
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={4}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500 resize-y"
                  placeholder='{"key": "value"}'
                />
                <VariableHelper workflow={workflow} currentStepId={step.id} onSelect={(val) => setEditBody(p => p + val)} />
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Tipo de Autenticación
                </label>
                <select
                  value={editAuthType}
                  onChange={(e) => setEditAuthType(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="none">Ninguna</option>
                  <option value="bearer">Bearer Token</option>
                </select>
              </div>

              {editAuthType === 'bearer' && (
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                    Bearer Token
                  </label>
                  <input
                    type="password"
                    value={editBearerToken}
                    onChange={(e) => setEditBearerToken(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                    placeholder="Token o {{secrets.token}}"
                  />
                  <VariableHelper workflow={workflow} currentStepId={step.id} onSelect={(val) => setEditBearerToken(p => p + val)} />
                </div>
              )}
            </div>
          ) : step.type === 'code' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Lenguaje
                </label>
                <select
                  value={editLanguage}
                  onChange={(e) => setEditLanguage(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="javascript">JavaScript (Node VM)</option>
                  <option value="python">Python 3 (Local Interpreter)</option>
                </select>
              </div>

              {editLanguage === 'javascript' && (
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                    Plantillas de Script (Snippets)
                  </label>
                  <select
                    onChange={(e) => {
                      const templateVal = e.target.value;
                      if (templateVal) {
                        setEditCode(templateVal);
                        e.target.value = '';
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Selecciona una plantilla para insertar...</option>
                    <option value={`// Hacer HTTP Fetch (Async)
const res = await fetch("https://api.github.com/repos/google/gemini-cookbook/releases/latest", {
  headers: { "User-Agent": "OpenCode" }
});
const data = await res.json();
console.log("Release info:", data.tag_name);
return { success: true, release: data.tag_name };`}>Hacer HTTP Fetch (Async)</option>
                    <option value={`// Buscar en opencode.db
const docs = await opencode.db.find("mi_base_datos", "mi_coleccion");
console.log("Documentos encontrados:", docs.length);
return { success: true, count: docs.length, data: docs };`}>opencode.db: Buscar documentos</option>
                    <option value={`// Insertar en opencode.db
const nuevoDoc = await opencode.db.insert("mi_base_datos", "mi_coleccion", null, {
  nombre: "Item Autogenerado",
  fecha: new Date().toISOString()
});
console.log("Documento insertado con ID:", nuevoDoc.id);
return { success: true, doc: nuevoDoc };`}>opencode.db: Insertar documento</option>
                    <option value={`// Actualizar en opencode.db
const docActualizado = await opencode.db.update("mi_base_datos", "mi_coleccion", "id_documento", {
  activo: true,
  ultimoAcceso: new Date().toISOString()
});
return { success: true, doc: docActualizado };`}>opencode.db: Actualizar documento</option>
                    <option value={`// Eliminar de opencode.db
const eliminado = await opencode.db.delete("mi_base_datos", "mi_coleccion", "id_documento");
console.log("¿Eliminado?:", eliminado);
return { success: true, eliminado };`}>opencode.db: Eliminar documento</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Código
                </label>
                <textarea
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value)}
                  rows={10}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-emerald-400 focus:outline-none focus:border-emerald-500 resize-y"
                  placeholder={editLanguage === 'javascript' ? '// JS Code\nreturn { success: true };' : '# Python Code\nprint("hello")'}
                />
                <div className="flex justify-between items-center mt-1">
                  <VariableHelper workflow={workflow} currentStepId={step.id} onSelect={(val) => setEditCode(p => p + val)} />
                   <span className="text-[9px] text-slate-500 font-mono italic">
                     {editLanguage === 'javascript' ? 'JavaScript corre en sandbox con console.log y acceso al contexto.' : 'Python corre con el intérprete local; usá el bloque Python dedicado para archivo, argumentos y timeout.'}
                   </span>
                </div>
                {editLanguage === 'python' && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-3">
                    <div>
                      <label className="block text-[10px] text-amber-300 uppercase font-bold mb-1 font-mono">Origen del script Python</label>
                      <div className="flex gap-2">
                        {(['inline', 'file'] as const).map(source => (
                          <button key={source} type="button" onClick={() => setEditCodeSource(source)} className={`rounded border px-2 py-1 text-[10px] ${editCodeSource === source ? 'border-amber-400 bg-amber-400/20 text-amber-200' : 'border-slate-700 text-slate-400'}`}>
                            {source === 'inline' ? 'Editor integrado' : 'Archivo del proyecto'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {editCodeSource === 'file' && (
                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1 font-mono">Ruta relativa del archivo</label>
                        <input value={editPythonFile} onChange={e => setEditPythonFile(e.target.value)} placeholder="scripts/transform.py" className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200" />
                        <p className="mt-1 text-[10px] text-slate-500">La ruta debe estar dentro del proyecto configurado.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : step.type === 'python' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">Origen del script</label>
                <div className="flex gap-2">
                  {(['inline', 'file'] as const).map(source => (
                    <button key={source} type="button" onClick={() => setEditCodeSource(source)} className={`rounded border px-2 py-1 text-[10px] ${editCodeSource === source ? 'border-amber-400 bg-amber-400/20 text-amber-200' : 'border-slate-700 text-slate-400'}`}>
                      {source === 'inline' ? 'Código inline' : 'Archivo del proyecto'}
                    </button>
                  ))}
                </div>
              </div>
              {editCodeSource === 'file' ? (
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">Ruta relativa (.py)</label>
                  <input value={editPythonFile} onChange={e => setEditPythonFile(e.target.value)} placeholder="scripts/transform.py" className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200" />
                  <p className="mt-1 text-[10px] text-slate-500">La ruta debe estar dentro del proyecto configurado.</p>
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">Código Python</label>
                  <textarea value={editCode} onChange={e => setEditCode(e.target.value)} rows={9} placeholder={'result = context["triggerPayload"]'} className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-500 resize-y" />
                  <VariableHelper workflow={workflow} currentStepId={step.id} onSelect={val => setEditCode(p => p + val)} />
                </div>
              )}
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">Argumentos</label>
                   <input value={editPythonArgs} onChange={e => setEditPythonArgs(e.target.value)} placeholder='["--modo", "fast"]' className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200" />
                 </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">Timeout (ms)</label>
                  <input type="number" min="1" max="300000" value={editPythonTimeout} onChange={e => setEditPythonTimeout(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200" />
                </div>
              </div>
            </div>
          ) : step.type === 'json_parser' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">Entrada (expresión)</label>
                <input value={editJsonInputExpr} onChange={e => setEditJsonInputExpr(e.target.value)} placeholder="context.triggerPayload" className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200" />
                <VariableHelper workflow={workflow} currentStepId={step.id} onSelect={val => setEditJsonInputExpr(val)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">Ruta a seleccionar</label>
                  <input value={editJsonPath} onChange={e => setEditJsonPath(e.target.value)} placeholder="data.items" className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">Ruta de rows (opcional)</label>
                  <input value={editJsonRowsPath} onChange={e => setEditJsonRowsPath(e.target.value)} placeholder="items" className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">Mapping de rows (JSON)</label>
                <textarea value={editJsonMapping} onChange={e => setEditJsonMapping(e.target.value)} rows={6} placeholder={'{"id":"id","name":"profile.name"}'} className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500 resize-y" />
                <p className="mt-1 text-[10px] text-slate-500">Cada clave nueva apunta a una ruta dentro de cada row.</p>
              </div>
            </div>
          ) : step.type === 'trigger' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Tipo de Disparador
                </label>
                <select
                  value={editTriggerType}
                  onChange={(e) => setEditTriggerType(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="manual">Manual</option>
                  <option value="webhook">Webhook</option>
                  <option value="cron">Cron (Planificador)</option>
                </select>
              </div>

              {editTriggerType === 'cron' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1.5 font-mono">
                      Presets Rápidos (Asistente)
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {CRON_PRESETS.map(preset => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setEditCronExpression(preset.expression);
                            setEditCronFrequency(preset.frequency);
                            setEditCronHour(preset.hour);
                            setEditCronMinute(preset.minute);
                          }}
                          className={`text-[10px] px-2 py-1 rounded border transition font-medium ${
                            editCronExpression === preset.expression
                              ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                              : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setEditCronFrequency('custom')}
                        className={`text-[10px] px-2 py-1 rounded border transition font-medium ${
                          editCronFrequency === 'custom'
                            ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                            : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
                        }`}
                      >
                        Personalizado
                      </button>
                    </div>
                  </div>

                  {editCronFrequency === 'custom' && (
                    <div className="grid grid-cols-2 gap-2 bg-slate-900/40 p-2 border border-slate-800 rounded">
                      <div>
                        <label className="block text-[9px] text-slate-500 uppercase font-bold mb-1 font-mono">Minuto (0-59)</label>
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={editCronMinute}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditCronMinute(val);
                            setEditCronExpression(`${val} ${editCronHour} * * *`);
                          }}
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-slate-500 uppercase font-bold mb-1 font-mono">Hora (0-23)</label>
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={editCronHour}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditCronHour(val);
                            setEditCronExpression(`${editCronMinute} ${val} * * *`);
                          }}
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 font-mono"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                      Expresión Cron (5 campos)
                    </label>
                    <input
                      type="text"
                      value={editCronExpression}
                      onChange={(e) => {
                        setEditCronExpression(e.target.value);
                        setEditCronFrequency('custom');
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                      placeholder="e.g. * * * * *"
                    />
                    {(() => {
                      const res = validateCronExpression(editCronExpression);
                      return (
                        <span className={`text-[10px] mt-1 block ${res.isValid ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {res.isValid ? '✓ Expresión Cron válida' : `✗ ${res.error}`}
                        </span>
                      );
                    })()}
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                      Zona Horaria
                    </label>
                    <select
                      value={editTimezone}
                      onChange={(e) => setEditTimezone(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                    >
                      {editTimezone && !TIMEZONE_OPTIONS.some(option => option.value === editTimezone) && <option value={editTimezone}>{editTimezone}</option>}
                      {TIMEZONE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <p className="text-[10px] text-slate-500 mt-1">Elegí por offset y ciudad; se guarda la zona técnica IANA.</p>
                  </div>
                </div>
              )}
            </div>
          ) : step.type === 'discord_notify' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Webhook URL de Discord
                </label>
                <input
                  type="text"
                  value={editDiscordWebhookUrl}
                  onChange={(e) => setEditDiscordWebhookUrl(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  placeholder="https://discord.com/api/webhooks/..."
                />
                <VariableHelper workflow={workflow} currentStepId={step.id} onSelect={(val) => setEditDiscordWebhookUrl(p => p + val)} />
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Mensaje
                </label>
                <textarea
                  value={editDiscordMessage}
                  onChange={(e) => setEditDiscordMessage(e.target.value)}
                  rows={4}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  placeholder="Contenido de la notificación..."
                />
                <VariableHelper workflow={workflow} currentStepId={step.id} onSelect={(val) => setEditDiscordMessage(p => p + val)} />
              </div>

            </div>
          ) : step.type === 'google_sheets' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Spreadsheet ID (ID del Documento)
                </label>
                <input
                  type="text"
                  value={editSheetsSpreadsheetId}
                  onChange={(e) => setEditSheetsSpreadsheetId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  placeholder="e.g. 1BxiMVs0XRA5n..."
                />
                <VariableHelper workflow={workflow} currentStepId={step.id} onSelect={(val) => setEditSheetsSpreadsheetId(p => p + val)} />
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Rango (Range)
                </label>
                <input
                  type="text"
                  value={editSheetsRange}
                  onChange={(e) => setEditSheetsRange(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  placeholder="e.g. Sheet1!A1:D"
                />
                <VariableHelper workflow={workflow} currentStepId={step.id} onSelect={(val) => setEditSheetsRange(p => p + val)} />
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  Operación
                </label>
                <select
                  value={editSheetsOperation}
                  onChange={(e) => setEditSheetsOperation(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="read">Leer Datos (Read)</option>
                  <option value="append">Agregar Fila (Append)</option>
                  <option value="update">Actualizar Rango (Update)</option>
                </select>
              </div>

              {editSheetsOperation !== 'read' && (
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                    Valores (Array de Arrays o variable)
                  </label>
                  <textarea
                    value={editSheetsValues}
                    onChange={(e) => setEditSheetsValues(e.target.value)}
                    rows={4}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                    placeholder='e.g. [["Celda A1", "Celda B1"]]'
                  />
                  <VariableHelper workflow={workflow} currentStepId={step.id} onSelect={(val) => setEditSheetsValues(p => p + val)} />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1 font-mono">
                  JSON de Configuración Crudo
                </label>
                <textarea
                  value={editJsonConfig}
                  onChange={(e) => handleJsonChange(e.target.value)}
                  rows={10}
                  className={`w-full bg-slate-900 border rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none resize-y ${
                    jsonError ? 'border-rose-500 focus:border-rose-500' : 'border-slate-800 focus:border-emerald-500'
                  }`}
                  placeholder="{}"
                />
                {jsonError && (
                  <span className="text-[10px] text-rose-400 font-mono mt-1 block">
                    Error: {jsonError}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Status Message */}
          {statusMessage && (
            <div className={`p-3 rounded-lg text-xs font-medium border ${
              statusMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}>
              {statusMessage.text}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2 border-t border-slate-800/60">
            <button
              type="button"
              onClick={handleSaveWorkflow}
              disabled={saving || !!jsonError}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-2 px-3 rounded flex items-center justify-center gap-1.5 transition text-xs"
            >
              {saving ? (
                <div className="h-3 w-3 rounded-full border border-white border-t-transparent animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span>Guardar en el Workflow</span>
            </button>

            {execution.status !== 'running' && execution.status !== 'queued' && (
              <button
                type="button"
                onClick={handleRewind}
                disabled={rewinding}
                className="w-full bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-200 border border-slate-700 font-bold py-2 px-3 rounded flex items-center justify-center gap-1.5 transition text-xs"
                title="Vuelve a ejecutar el pipeline desde este paso restaurando el snapshot previo."
              >
                {rewinding ? (
                  <div className="h-3 w-3 rounded-full border border-slate-200 border-t-transparent animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                <span>Re-ejecutar desde este nodo</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderOutput = () => {
    if (output === undefined) {
      return <span className="text-slate-500 text-xs font-sans">Sin salida registrada para este paso.</span>;
    }
    if (typeof output === 'string') {
      return (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-md p-3 text-xs text-slate-200 whitespace-pre-wrap break-words leading-relaxed max-h-52 overflow-y-auto font-mono">
          {output}
        </div>
      );
    }
    return (
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-md p-2 overflow-x-auto max-h-52 overflow-y-auto">
        <ReadonlyJson data={output} />
      </div>
    );
  };

  const renderCurrentResult = () => {
    if (status === 'pending' || status === 'running') {
      return (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 text-center flex flex-col items-center justify-center gap-3">
          {status === 'running' ? (
            <>
              <div className="h-6 w-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
              <span className="text-xs text-slate-300 font-semibold block font-sans">
                El paso está en ejecución en este momento...
              </span>
            </>
          ) : (
            <span className="text-xs text-slate-500 block font-sans">
              Este paso está pendiente. Esperando su turno de ejecución en el pipeline.
            </span>
          )}
        </div>
      );
    }

    if (step.type === 'agent') {
      return (
        <div className="space-y-4 font-sans">
          <AgentResponse step={step} output={output} metrics={metrics} logs={stepLogs} />
        </div>
      );
    }

    return (
      <div className="space-y-3 font-sans">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1 font-mono">
          Datos de Salida
        </span>
        {renderOutput()}
      </div>
    );
  };

  const renderStepLogs = () => {
    return (
      <div className="space-y-3 font-sans">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1 font-mono">
          Logs del paso ({stepLogs.length})
        </span>
        {stepLogs.length === 0 ? (
          <span className="text-slate-500 text-xs italic block p-3 bg-slate-900/40 border border-slate-800/80 rounded-md text-center">
            No hay logs asociados a este paso.
          </span>
        ) : (
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-md p-2.5 font-mono text-[10px] text-slate-300 space-y-1.5 max-h-80 overflow-y-auto">
            {stepLogs.map((l, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="text-slate-600 shrink-0 pt-0.5">{new Date(l.timestamp).toLocaleTimeString()}</span>
                <span className={`px-1.5 rounded text-[9px] font-bold uppercase shrink-0 ${levelClass(l.level)}`}>
                  {l.level}
                </span>
                <span className="whitespace-pre-wrap break-words leading-relaxed">{l.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderFlujoTab = () => {
    return (
      <div className="relative pl-6 border-l border-emerald-500/20 space-y-8 ml-3 py-2 text-left">
        {/* SECTION 1: ENTRADA */}
        <div className="relative group transition-all duration-300">
          {/* Glow dot centered on border-left */}
          <div className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.8)] group-hover:scale-110 transition-transform duration-300" />
          
          <div className="space-y-2.5">
            <h4 className="font-mono text-[11px] font-bold text-emerald-400 tracking-wider uppercase flex items-center gap-2">
              <span className="text-[9px] bg-emerald-950/65 px-1.5 py-0.5 rounded border border-emerald-500/20 font-bold">01</span>
              ENTRADA (Input)
            </h4>
            <div className="bg-slate-950/60 backdrop-blur-md border border-slate-800/80 rounded-xl p-4 transition-all duration-300 hover:border-slate-700/80 shadow-md">
              {renderPrecedingOutputs()}
            </div>
          </div>
        </div>

        {/* SECTION 2: PROCESAMIENTO */}
        <div className="relative group transition-all duration-300">
          {/* Glow dot centered on border-left */}
          <div className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.8)] group-hover:scale-110 transition-transform duration-300" />
          
          <div className="space-y-2.5">
            <h4 className="font-mono text-[11px] font-bold text-emerald-400 tracking-wider uppercase flex items-center gap-2">
              <span className="text-[9px] bg-emerald-950/65 px-1.5 py-0.5 rounded border border-emerald-500/20 font-bold">02</span>
              PROCESAMIENTO (Config/Nodo)
            </h4>
            <div className="bg-slate-950/60 backdrop-blur-md border border-slate-800/80 rounded-xl p-4 space-y-4 transition-all duration-300 hover:border-slate-700/80 shadow-md">
              {renderCurrentNodeInfo()}
              <div className="border-t border-slate-800/60 pt-3">
                {renderStepConfig()}
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 3: SALIDA */}
        <div className="relative group transition-all duration-300">
          {/* Glow dot centered on border-left */}
          <div className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.8)] group-hover:scale-110 transition-transform duration-300" />
          
          <div className="space-y-2.5">
            <h4 className="font-mono text-[11px] font-bold text-emerald-400 tracking-wider uppercase flex items-center gap-2">
              <span className="text-[9px] bg-emerald-950/65 px-1.5 py-0.5 rounded border border-emerald-500/20 font-bold">03</span>
              SALIDA (Output)
            </h4>
            <div className="bg-slate-950/60 backdrop-blur-md border border-slate-800/80 rounded-xl p-4 transition-all duration-300 hover:border-slate-700/80 shadow-md">
              {renderCurrentResult()}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full h-full bg-slate-950 border-l border-slate-800 flex flex-col min-h-0">
      {/* Panel header */}
      <div className="p-3 border-b border-slate-800 flex items-start justify-between gap-2 bg-slate-900/40">
        <div className="min-w-0">
          <span className="font-bold text-slate-100 text-sm truncate block font-sans">{getStepDisplayName(step)}</span>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 font-sans">{step.type}</span>
            <StatusBadge status={status} />
            {timing && (
              <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                <Clock className="h-3 w-3" /> {formatDuration(timing.durationMs)}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Cerrar detalle"
           className="icon-btn text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition shrink-0"
           aria-label="Cerrar detalle del paso"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs Bar Selector */}
      <div className="flex border-b border-slate-800 bg-slate-900/30 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
        {[
          { id: 'flujo', label: 'Flujo', icon: Cpu },
          { id: 'config', label: 'Configuración', icon: FileCode },
          { id: 'logs', label: 'Logs', icon: Terminal }
        ].map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as any)}
               className={`flex-1 min-h-11 py-2.5 px-1 flex flex-col items-center justify-center gap-1 border-b-2 font-sans transition ${
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

      {/* Panel scrollable body */}
      <div className="flex-1 overflow-y-auto p-3 text-left">
        {activeTab === 'flujo' && renderFlujoTab()}
        {activeTab === 'config' && renderConfigTab()}
        {activeTab === 'logs' && renderStepLogs()}
      </div>
    </div>
  );
};
