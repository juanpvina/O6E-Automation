import React, { useEffect, useState } from 'react';
import {
  Zap,
  Clock,
  Play,
  Bot,
  Code,
  Braces,
  Sliders,
  Wand2,
  Globe,
  Database,
  GitCommit,
  GitPullRequest,
  Split,
  Repeat,
  Timer,
  UserCheck,
  Search,
  X,
  MessageSquare,
  FileSpreadsheet,
  Terminal
} from 'lucide-react';
import { StepType } from '@opencode/shared';
import { STEP_CATALOG_METADATA } from '../lib/constants';

interface StepCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (type: StepType, configOverrides?: Record<string, any>) => void;
}

interface StepItem {
  id: string;
  type: StepType;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  configOverrides?: Record<string, any>;
  setupHint?: string;
  badge?: string;
}

interface StepCategory {
  name: string;
  items: StepItem[];
}

export const StepCatalogModal: React.FC<StepCatalogModalProps> = ({
  isOpen,
  onClose,
  onSelect
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const closeModal = () => {
    setSearchQuery('');
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const iconById: Record<string, StepItem['icon']> = {
    'trigger-webhook': Zap, 'trigger-cron': Clock, 'trigger-manual': Play, agent: Bot,
    code: Code, python: Terminal, json_parser: Braces, normalizer: Sliders, transform: Wand2,
    http_request: Globe, nosql: Database, git: GitCommit, pr: GitPullRequest,
    discord_notify: MessageSquare, google_sheets: FileSpreadsheet, condition: Split,
    parallel: Split, loop: Repeat, wait: Timer, retry: Repeat, approval: UserCheck
  };
  const colorById: Record<string, string> = {
    'trigger-webhook': 'text-emerald-400 border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-950/20',
    'trigger-cron': 'text-teal-400 border-teal-500/20 hover:border-teal-500/50 hover:bg-teal-950/20',
    'trigger-manual': 'text-sky-400 border-sky-500/20 hover:border-sky-500/50 hover:bg-sky-950/20',
    agent: 'text-purple-400 border-purple-500/20 hover:border-purple-500/50 hover:bg-purple-950/20',
    code: 'text-lime-400 border-lime-500/20 hover:border-lime-500/50 hover:bg-lime-950/20',
    python: 'text-amber-400 border-amber-500/20 hover:border-amber-500/50 hover:bg-amber-950/20',
    json_parser: 'text-cyan-400 border-cyan-500/20 hover:border-cyan-500/50 hover:bg-cyan-950/20',
    normalizer: 'text-cyan-400 border-cyan-500/20 hover:border-cyan-500/50 hover:bg-cyan-950/20',
    transform: 'text-pink-400 border-pink-500/20 hover:border-pink-500/50 hover:bg-pink-950/20',
    http_request: 'text-sky-400 border-sky-500/20 hover:border-sky-500/50 hover:bg-sky-950/20',
    nosql: 'text-emerald-400 border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-950/20',
    git: 'text-blue-400 border-blue-500/20 hover:border-blue-500/50 hover:bg-blue-950/20',
    pr: 'text-indigo-400 border-indigo-500/20 hover:border-indigo-500/50 hover:bg-indigo-950/20',
    discord_notify: 'text-indigo-400 border-indigo-500/20 hover:border-indigo-500/50 hover:bg-indigo-950/20',
    google_sheets: 'text-emerald-400 border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-950/20',
    condition: 'text-amber-400 border-amber-500/20 hover:border-amber-500/50 hover:bg-amber-950/20',
    parallel: 'text-sky-500 border-sky-500/20 hover:border-sky-500/50 hover:bg-sky-950/20',
    loop: 'text-violet-400 border-violet-500/20 hover:border-violet-500/50 hover:bg-violet-950/20',
    wait: 'text-yellow-400 border-yellow-500/20 hover:border-yellow-500/50 hover:bg-yellow-950/20',
    retry: 'text-rose-400 border-rose-500/20 hover:border-rose-500/50 hover:bg-rose-950/20',
    approval: 'text-orange-400 border-orange-500/20 hover:border-orange-500/50 hover:bg-orange-950/20'
  };
  const categories: StepCategory[] = Object.values(
    STEP_CATALOG_METADATA.reduce<Record<string, StepCategory>>((result, metadata) => {
      const category = result[metadata.category] || (result[metadata.category] = { name: metadata.category, items: [] });
      category.items.push({ ...metadata, icon: iconById[metadata.id], color: colorById[metadata.id] });
      return result;
    }, {})
  );
  /* Catalog content lives in constants; this component only adds rendering metadata. */
  /*
    The old inline catalog was intentionally removed to keep labels, help text and
    defaults consistent across future catalog surfaces.
  */
  /*
  const categories: StepCategory[] = [
    {
      name: 'Disparadores',
      items: [
        {
          id: 'trigger-webhook',
          type: 'trigger',
          name: 'Webhook',
          description: 'Inicia el workflow al recibir una petición HTTP POST externa con payload JSON.',
          icon: Zap,
          color: 'text-emerald-400 border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-950/20',
          configOverrides: { triggerType: 'webhook', name: 'Trigger Webhook' },
          setupHint: 'Solo necesitás definir el payload y conectar el siguiente paso.', badge: 'Entrada'
        },
        {
          id: 'trigger-cron',
          type: 'trigger',
          name: 'Cron Schedule',
          description: 'Ejecuta el workflow de forma recurrente según una planificación temporal (cron).',
          icon: Clock,
          color: 'text-teal-400 border-teal-500/20 hover:border-teal-500/50 hover:bg-teal-950/20',
          configOverrides: { triggerType: 'cron', name: 'Trigger Cron' }
        },
        {
          id: 'trigger-manual',
          type: 'trigger',
          name: 'Disparo Manual',
          description: 'Inicia la ejecución bajo demanda desde el dashboard del orquestador.',
          icon: Play,
          color: 'text-sky-400 border-sky-500/20 hover:border-sky-500/50 hover:bg-sky-950/20',
          configOverrides: { triggerType: 'manual', name: 'Disparo Manual' }
        }
      ]
    },
    {
      name: 'Inteligencia Artificial',
      items: [
        {
          id: 'agent',
          type: 'agent',
          name: 'Agente OpenCode',
          description: 'Invoca a un agente autónomo de IA (Gemini/Claude) para diagnosticar y aplicar fixes en caliente.',
          icon: Bot,
          color: 'text-purple-400 border-purple-500/20 hover:border-purple-500/50 hover:bg-purple-950/20',
          configOverrides: { name: 'Agente OpenCode' },
          setupHint: 'Requiere prompt, proveedor y modelo.', badge: 'IA'
        }
      ]
    },
    {
      name: 'Código y Datos',
      items: [
        {
          id: 'code',
          type: 'code',
          name: 'Script de Código',
          description: 'Ejecuta JavaScript en un sandbox seguro con acceso al contexto del workflow.',
          icon: Code,
          color: 'text-lime-400 border-lime-500/20 hover:border-lime-500/50 hover:bg-lime-950/20',
          configOverrides: { name: 'Script de Código', language: 'javascript' }
        },
        {
          id: 'python',
          type: 'python',
          name: 'Python Script',
          description: 'Ejecuta Python 3 con código inline o un archivo .py del proyecto, argumentos y timeout configurable.',
          icon: Terminal,
          color: 'text-amber-400 border-amber-500/20 hover:border-amber-500/50 hover:bg-amber-950/20',
          configOverrides: { name: 'Python Script' }
        },
        {
          id: 'json_parser',
          type: 'json_parser',
          name: 'JSON Parser',
          description: 'Selecciona una ruta JSON y convierte colecciones en rows usando un mapping opcional.',
          icon: Braces,
          color: 'text-cyan-400 border-cyan-500/20 hover:border-cyan-500/50 hover:bg-cyan-950/20',
          configOverrides: { name: 'JSON Parser' }
        },
        {
          id: 'normalizer',
          type: 'normalizer',
          name: 'Normalizar Payload',
          description: 'Mapea y estructura las propiedades de salida de pasos anteriores a variables limpias.',
          icon: Sliders,
          color: 'text-cyan-400 border-cyan-500/20 hover:border-cyan-500/50 hover:bg-cyan-950/20',
          configOverrides: { name: 'Normalizar Payload' }
        },
        {
          id: 'transform',
          type: 'transform',
          name: 'Format Template',
          description: 'Utiliza plantillas con sintaxis {{variable}} para componer textos y reportes estructurados.',
          icon: Wand2,
          color: 'text-pink-400 border-pink-500/20 hover:border-pink-500/50 hover:bg-pink-950/20',
          configOverrides: { name: 'Format Template' }
        }
      ]
    },
    {
      name: 'Integraciones',
      items: [
        {
          id: 'http_request',
          type: 'http_request',
          name: 'HTTP Request',
          description: 'Realiza peticiones HTTP personalizadas (GET, POST, PUT, DELETE) con cabeceras y body.',
          icon: Globe,
          color: 'text-sky-400 border-sky-500/20 hover:border-sky-500/50 hover:bg-sky-950/20',
          configOverrides: { name: 'Llamada HTTP' },
          setupHint: 'Requiere URL y método HTTP.', badge: 'Externo'
        },
        {
          id: 'nosql',
          type: 'nosql',
          name: 'Base NoSQL',
          description: 'Interactúa con la base de datos local (buscar, insertar, actualizar o eliminar documentos).',
          icon: Database,
          color: 'text-emerald-400 border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-950/20',
          configOverrides: { name: 'Base NoSQL' },
          setupHint: 'Elegí una base y colección antes de guardar.', badge: 'Datos'
        },
        {
          id: 'git',
          type: 'git',
          name: 'Git Commit',
          description: 'Crea una rama local en el espacio del proyecto y realiza commit de los archivos modificados.',
          icon: GitCommit,
          color: 'text-blue-400 border-blue-500/20 hover:border-blue-500/50 hover:bg-blue-950/20',
          configOverrides: { name: 'Git Commit' }
        },
        {
          id: 'pr',
          type: 'pr',
          name: 'GitHub PR',
          description: 'Abre un Pull Request en GitHub para revisión de código utilizando las credenciales del proyecto.',
          icon: GitPullRequest,
          color: 'text-indigo-400 border-indigo-500/20 hover:border-indigo-500/50 hover:bg-indigo-950/20',
          configOverrides: { name: 'Crear PR' }
        },
        {
          id: 'discord_notify',
          type: 'discord_notify',
          name: 'Discord Notifier',
          description: 'Envía notificaciones a canales de Discord usando Webhooks con soporte para variables.',
          icon: MessageSquare,
          color: 'text-indigo-400 border-indigo-500/20 hover:border-indigo-500/50 hover:bg-indigo-950/20',
          configOverrides: { name: 'Notificación de Discord' }
        },
        {
          id: 'google_sheets',
          type: 'google_sheets',
          name: 'Google Sheets',
          description: 'Lee o escribe datos en hojas de cálculo de Google Sheets de manera automatizada.',
          icon: FileSpreadsheet,
          color: 'text-emerald-400 border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-950/20',
          configOverrides: { name: 'Google Sheets' }
        }
      ]
    },
    {
      name: 'Lógica y Control',
      items: [
        {
          id: 'condition',
          type: 'condition',
          name: 'Condicional',
          description: 'Evalúa una expresión booleana para bifurcar el flujo del workflow en caminos Verdadero / Falso.',
          icon: Split,
          color: 'text-amber-400 border-amber-500/20 hover:border-amber-500/50 hover:bg-amber-950/20',
          configOverrides: { name: 'Evaluación Condicional' }
        },
        {
          id: 'parallel',
          type: 'parallel',
          name: 'Ejecución Paralela',
          description: 'Divide la ejecución del workflow en múltiples hilos y sincroniza sus resultados al finalizar.',
          icon: Split,
          color: 'text-sky-500 border-sky-500/20 hover:border-sky-500/50 hover:bg-sky-950/20',
          configOverrides: { name: 'Paralelo' }
        },
        {
          id: 'loop',
          type: 'loop',
          name: 'Ciclo Loop',
          description: 'Itera secuencialmente sobre colecciones de ítems ejecutando sub-pasos definidos.',
          icon: Repeat,
          color: 'text-violet-400 border-violet-500/20 hover:border-violet-500/50 hover:bg-violet-950/20',
          configOverrides: { name: 'Ciclo Loop' }
        },
        {
          id: 'wait',
          type: 'wait',
          name: 'Espera temporal',
          description: 'Detiene temporalmente el flujo durante una cantidad fija de milisegundos.',
          icon: Timer,
          color: 'text-yellow-400 border-yellow-500/20 hover:border-yellow-500/50 hover:bg-yellow-950/20',
          configOverrides: { name: 'Esperar' }
        },
        {
          id: 'retry',
          type: 'retry',
          name: 'Reintento de Paso',
          description: 'Reejecuta automáticamente un paso fallido según límites y retrasos configurados.',
          icon: Repeat,
          color: 'text-rose-400 border-rose-500/20 hover:border-rose-500/50 hover:bg-rose-950/20',
          configOverrides: { name: 'Reintentar' }
        },
        {
          id: 'approval',
          type: 'approval',
          name: 'Aprobación Humana',
          description: 'Pausa la ejecución y solicita consentimiento explícito de un administrador para continuar.',
          icon: UserCheck,
          color: 'text-orange-400 border-orange-500/20 hover:border-orange-500/50 hover:bg-orange-950/20',
          configOverrides: { name: 'Aprobación Requerida' }
        }
      ]
    }
  ];
  */

  // Filter items based on search query
  const filteredCategories = categories
    .map(category => ({
      ...category,
      items: category.items.filter(
        item =>
          item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }))
    .filter(category => category.items.length > 0);

  return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in font-sans" onMouseDown={closeModal}>
        <div 
          role="dialog"
          aria-modal="true"
          aria-labelledby="step-catalog-title"
          className="relative w-full max-w-4xl max-h-[85vh] flex flex-col bg-slate-900 border border-slate-800 rounded-xl shadow-2xl shadow-emerald-950/10 overflow-hidden"
          onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
              <Zap className="h-5 w-5 animate-pulse" />
            </div>
            <div>
               <h3 id="step-catalog-title" className="text-lg font-bold text-slate-100">Catálogo de Pasos</h3>
              <p className="text-xs text-slate-400">Selecciona el tipo de nodo que deseas agregar a tu workflow</p>
            </div>
          </div>
           <button
             type="button"
             onClick={closeModal}
             aria-label="Cerrar catálogo de pasos"
            className="p-1.5 rounded-lg border border-slate-850 bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
          >
           <X className="h-4 w-4" />
           </button>
         </div>

         {/* Search Bar */}
         <div className="px-6 py-3 bg-slate-900/60 border-b border-slate-800 flex items-center gap-3">
          <Search className="h-4 w-4 text-slate-500" />
           <input
             aria-label="Buscar pasos por nombre o descripción"
            type="text"
            placeholder="Buscar paso por nombre o descripción..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent border-0 outline-none text-sm text-slate-200 placeholder-slate-500 font-sans"
            autoFocus
         />
           <span className="hidden sm:block text-[10px] text-slate-500 whitespace-nowrap">{filteredCategories.reduce((count, category) => count + category.items.length, 0)} disponibles</span>
        </div>

        {/* Categories / Steps Grid */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {filteredCategories.length > 0 ? (
            filteredCategories.map(category => (
              <div key={category.name} className="space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider pl-1 border-l-2 border-emerald-500">
                  {category.name}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {category.items.map(item => {
                    const Icon = item.icon;
                    return (
                       <button
                         type="button"
                         key={item.id}
                         onClick={() => onSelect(item.type, item.configOverrides)}
                         className={`flex flex-col p-4 bg-slate-900/40 rounded-xl border cursor-pointer transition-all duration-300 group hover:shadow-lg hover:shadow-emerald-950/5 hover:-translate-y-0.5 ${item.color}`}
                      >
                         <div className="flex items-center gap-3 mb-2.5">
                          <div className="p-2 rounded-lg bg-slate-800/80 group-hover:bg-slate-800 transition-colors">
                             <Icon className="h-4 w-4" />
                           </div>
                            <span className="font-semibold text-slate-200 text-sm tracking-tight">{item.name}</span>
                            {item.badge && <span className="ml-auto text-[9px] uppercase tracking-wider text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">{item.badge}</span>}
                         </div>
                         <p className="text-xs text-slate-400 font-normal leading-relaxed line-clamp-3">
                           {item.description}
                          </p>
                         {item.setupHint && <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">Configuración: {item.setupHint}</p>}
                       </button>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-slate-500">
              No se encontraron pasos coincidentes.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
