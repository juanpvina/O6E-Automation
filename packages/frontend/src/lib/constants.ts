import { SchemaNodeType, StepType, Workflow } from '@opencode/shared';

// ==========================================
// 1. Mock Data Dictionary for StepType Outputs
// ==========================================
export const MOCK_STEP_OUTPUTS: Record<StepType, Record<string, any>> = {
  trigger: {
    triggerType: 'webhook',
    triggeredAt: '2026-08-20T12:00:00.000Z',
    payload: {
      message: 'Build failed on main branch due to syntax error in server.ts',
      commit: 'a3b2c1d',
      author: 'juanp'
    }
  },
  normalizer: {
    message: 'Build failed on main branch due to syntax error in server.ts',
    errorSource: 'server.ts',
    timestamp: '2026-08-20T12:00:05.000Z',
    severity: 'CRITICAL'
  },
  agent: {
    success: true,
    suggestedFix: "Fix typo on line 42: replace 'req.bod' with 'req.body'",
    fileModified: 'server.ts',
    patch: '@@ -42,3 +42,3 @@\n-  const data = req.bod;\n+  const data = req.body;',
    confidenceScore: 0.98,
    output: 'The syntax error has been identified and corrected. Typo in req.body was resolved.'
  },
  condition: {
    expressionEvaluated: 'context.stepOutputs.agent1.success === true',
    result: true,
    evaluatedAt: '2026-08-20T12:00:10.000Z'
  },
  shell_test: {
    command: 'npm test',
    exitCode: 0,
    stdout: '✓ server.ts imports correctly\n✓ auth middleware passes\n\nTest Suites: 2 passed, 2 total\nTests:       15 passed, 15 total\nSnapshots:   0 total\nTime:        1.45s',
    stderr: '',
    durationMs: 1450
  },
  git: {
    branch: 'fix/server-syntax-error',
    commitHash: 'f6e5d4c3b2a1',
    committedFiles: ['server.ts'],
    message: 'fix: resolve syntax error in server.ts req.body typo'
  },
  pr: {
    pullRequestNumber: 142,
    htmlUrl: 'https://github.com/opencode/project/pull/142',
    status: 'open',
    title: 'OpenCode Auto-Fix: Resolve server.ts syntax error',
    mergeable: true
  },
  transform: {
    outputText: 'Workflow Report:\n- Bug diagnosed in server.ts\n- Automated fix applied successfully\n- Tests passed successfully (exit code 0)\n- Pull Request #142 created.'
  },
  output: {
    filePath: 'opencode-report.txt',
    bytesWritten: 154,
    status: 'written_success'
  },
  approval: {
    approvalId: 'approval_4567',
    approved: true,
    approvedBy: 'reviewer_admin',
    actionTimestamp: '2026-08-20T12:01:30.000Z',
    comments: 'Looks solid, safe to proceed with the PR merge.'
  },
  nosql: {
    success: true,
    result: { id: 'doc_12345', name: 'example', value: true }
  },
  parallel: {
    branches: ['agent_fix_frontend', 'agent_fix_backend'],
    joinStepId: 'transform_report',
    outputs: {
      agent_fix_frontend: { success: true, patchCount: 3 },
      agent_fix_backend: { success: true, patchCount: 2 }
    }
  },
  loop: {
    itemVar: 'item',
    iterationsCompleted: 4,
    processedItems: ['a', 'b', 'c', 'd'],
    output: 'Processed 4 items successfully.'
  },
  retry: {
    attempts: 2,
    success: true,
    lastError: 'npm test failed once, then succeeded on retry.'
  },
  wait: {
    durationMs: 5000,
    waitedUntil: '2026-08-20T12:00:15.000Z'
  },
  http_request: {
    success: true,
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    responseBody: '{"status":"ok","data":{"id":123}}'
  },
  code: {
    success: true,
    result: { status: 'processed', result: 42 }
  },
  discord_notify: {
    success: true,
    messageId: '123456789012345678',
    channelId: '876543210987654321'
  },
  google_sheets: {
    success: true,
    spreadsheetId: '1BxiMVs0XRA5nFMdKv1a39wOPot4VDF8S7yMC5mQ57wg',
    updatedCells: 12
  },
  python: { success: true, result: { status: 'processed' }, stdout: '', stderr: '' },
  json_parser: { success: true, data: [], rows: [], count: 0 }
};

export const STEP_TYPE_FALLBACK_NAMES: Partial<Record<StepType, string>> = {
  parallel: 'Parallel',
  loop: 'Loop',
  retry: 'Retry',
  wait: 'Wait',
  http_request: 'HTTP Request',
  code: 'Script de Código',
  discord_notify: 'Notificación de Discord',
  google_sheets: 'Google Sheets'
};

export interface StepCatalogMetadata {
  id: string;
  category: string;
  type: StepType;
  name: string;
  description: string;
  configOverrides?: Record<string, any>;
  setupHint?: string;
  badge?: string;
}

export const STEP_CATALOG_METADATA: StepCatalogMetadata[] = [
  { id: 'trigger-webhook', category: 'Disparadores', type: 'trigger', name: 'Webhook', description: 'Inicia el workflow al recibir una petición HTTP POST externa con payload JSON.', configOverrides: { triggerType: 'webhook', name: 'Trigger Webhook' }, setupHint: 'Definí el payload y conectá el siguiente paso.', badge: 'Entrada' },
  { id: 'trigger-cron', category: 'Disparadores', type: 'trigger', name: 'Cron Schedule', description: 'Ejecuta el workflow de forma recurrente según una planificación cron.', configOverrides: { triggerType: 'cron', name: 'Trigger Cron' } },
  { id: 'trigger-manual', category: 'Disparadores', type: 'trigger', name: 'Disparo Manual', description: 'Inicia la ejecución bajo demanda desde el dashboard.', configOverrides: { triggerType: 'manual', name: 'Disparo Manual' } },
  { id: 'agent', category: 'Inteligencia Artificial', type: 'agent', name: 'Agente OpenCode', description: 'Invoca un agente autónomo de IA para diagnosticar y aplicar cambios en el proyecto.', configOverrides: { name: 'Agente OpenCode' }, setupHint: 'Requiere prompt, proveedor y modelo.', badge: 'IA' },
  { id: 'code', category: 'Código y Datos', type: 'code', name: 'Script de Código', description: 'Ejecuta JavaScript en un sandbox con acceso al contexto del workflow.', configOverrides: { name: 'Script de Código', language: 'javascript' } },
  { id: 'python', category: 'Código y Datos', type: 'python', name: 'Python Script', description: 'Ejecuta Python 3 inline o desde un archivo del proyecto, con argumentos y timeout.', configOverrides: { name: 'Python Script' } },
  { id: 'json_parser', category: 'Código y Datos', type: 'json_parser', name: 'JSON Parser', description: 'Selecciona una ruta JSON y convierte colecciones en filas usando un mapping opcional.', configOverrides: { name: 'JSON Parser' } },
  { id: 'normalizer', category: 'Código y Datos', type: 'normalizer', name: 'Normalizar Payload', description: 'Mapea propiedades de pasos anteriores a una estructura de datos limpia.', configOverrides: { name: 'Normalizar Payload' } },
  { id: 'transform', category: 'Código y Datos', type: 'transform', name: 'Format Template', description: 'Compone textos y reportes con plantillas {{variable}}.', configOverrides: { name: 'Format Template' } },
  { id: 'http_request', category: 'Integraciones', type: 'http_request', name: 'HTTP Request', description: 'Realiza peticiones HTTP con método, cabeceras, body y autenticación configurables.', configOverrides: { name: 'Llamada HTTP' }, setupHint: 'Requiere URL y método HTTP.', badge: 'Externo' },
  { id: 'nosql', category: 'Integraciones', type: 'nosql', name: 'Base NoSQL', description: 'Busca, inserta, actualiza o elimina documentos en la base local.', configOverrides: { name: 'Base NoSQL' }, setupHint: 'Elegí una base y colección.', badge: 'Datos' },
  { id: 'git', category: 'Integraciones', type: 'git', name: 'Git Commit', description: 'Crea una rama local y registra los archivos modificados del proyecto.', configOverrides: { name: 'Git Commit' } },
  { id: 'pr', category: 'Integraciones', type: 'pr', name: 'GitHub PR', description: 'Abre un Pull Request para revisión de código usando las credenciales del proyecto.', configOverrides: { name: 'Crear PR' } },
  { id: 'discord_notify', category: 'Integraciones', type: 'discord_notify', name: 'Discord Notifier', description: 'Envía notificaciones a Discord mediante un webhook con variables interpoladas.', configOverrides: { name: 'Notificación de Discord' } },
  { id: 'google_sheets', category: 'Integraciones', type: 'google_sheets', name: 'Google Sheets', description: 'Lee o escribe datos en hojas de cálculo de Google Sheets.', configOverrides: { name: 'Google Sheets' } },
  { id: 'condition', category: 'Lógica y Control', type: 'condition', name: 'Condicional', description: 'Evalúa una expresión booleana y bifurca el flujo en Verdadero/Falso.', configOverrides: { name: 'Evaluación Condicional' } },
  { id: 'parallel', category: 'Lógica y Control', type: 'parallel', name: 'Ejecución Paralela', description: 'Divide el workflow en ramas y sincroniza sus resultados.', configOverrides: { name: 'Paralelo' } },
  { id: 'loop', category: 'Lógica y Control', type: 'loop', name: 'Ciclo Loop', description: 'Itera sobre una colección ejecutando una rama por cada elemento.', configOverrides: { name: 'Ciclo Loop' } },
  { id: 'wait', category: 'Lógica y Control', type: 'wait', name: 'Espera temporal', description: 'Pausa el flujo durante una cantidad fija de milisegundos.', configOverrides: { name: 'Esperar' } },
  { id: 'retry', category: 'Lógica y Control', type: 'retry', name: 'Reintento de Paso', description: 'Reejecuta una rama fallida según límites y retrasos configurados.', configOverrides: { name: 'Reintentar' } },
  { id: 'approval', category: 'Lógica y Control', type: 'approval', name: 'Aprobación Humana', description: 'Pausa la ejecución y solicita consentimiento explícito antes de continuar.', configOverrides: { name: 'Aprobación Requerida' } }
];

export const HANG_THRESHOLD_MS = 5 * 60 * 1000;

export const STANDARD_TIMEZONES = [
  'America/Bogota', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Mexico_City', 'America/Argentina/Buenos_Aires',
  'America/Santiago', 'America/Lima', 'America/Caracas', 'America/Sao_Paulo',
  'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome',
  'UTC', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Dubai', 'Australia/Sydney'
];

// Opciones visibles para el selector del editor. El valor guardado sigue siendo
// la zona IANA que entiende el scheduler; la etiqueta ayuda a elegir sin
// tener que conocer todos los nombres técnicos.
export const TIMEZONE_OPTIONS = [
  { value: 'America/Bogota', label: 'GMT-5 — Colombia (America/Bogota)' },
  { value: 'America/New_York', label: 'GMT-5/-4 — Nueva York (America/New_York)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'GMT-3 — Buenos Aires (America/Argentina/Buenos_Aires)' },
  { value: 'America/Sao_Paulo', label: 'GMT-3 — São Paulo (America/Sao_Paulo)' },
  { value: 'America/Santiago', label: 'GMT-4/-3 — Santiago (America/Santiago)' },
  { value: 'America/Mexico_City', label: 'GMT-6 — Ciudad de México (America/Mexico_City)' },
  { value: 'UTC', label: 'GMT+0 — UTC' },
  { value: 'Europe/London', label: 'GMT+0/+1 — Londres (Europe/London)' },
  { value: 'Europe/Madrid', label: 'GMT+1/+2 — Madrid (Europe/Madrid)' },
  { value: 'Asia/Tokyo', label: 'GMT+9 — Tokio (Asia/Tokyo)' },
  { value: 'Asia/Shanghai', label: 'GMT+8 — Shanghái (Asia/Shanghai)' },
  { value: 'Australia/Sydney', label: 'GMT+10/+11 — Sídney (Australia/Sydney)' },
] as const;

export const CRON_PRESETS = [
  { id: 'every-minute', label: 'Cada minuto', expression: '* * * * *', frequency: 'minute', hour: '0', minute: '0' },
  { id: 'every-hour', label: 'Cada hora', expression: '0 * * * *', frequency: 'hourly', hour: '0', minute: '0' },
  { id: 'daily', label: 'Diario, 09:00', expression: '0 9 * * *', frequency: 'daily', hour: '9', minute: '0' },
  { id: 'weekdays', label: 'Lunes a viernes, 09:00', expression: '0 9 * * 1-5', frequency: 'weekly', hour: '9', minute: '0' },
  { id: 'weekly', label: 'Semanal, lunes 09:00', expression: '0 9 * * 1', frequency: 'weekly', hour: '9', minute: '0' },
  { id: 'monthly', label: 'Mensual, día 1', expression: '0 9 1 * *', frequency: 'monthly', hour: '9', minute: '0' }
] as const;

export const SCHEMA_TYPES: SchemaNodeType[] = ['string', 'number', 'boolean', 'object', 'array'];

export interface StartTemplate {
  id: string;
  name: string;
  description: string;
  category?: string;
  difficulty?: 'Inicial' | 'Intermedio' | 'Avanzado';
  stepCount?: number;
  tags?: string[];
}

// 3.7. Starting templates (workflow designer)
export const START_TEMPLATES: StartTemplate[] = [
  { id: 'webhook-process-approve-save', name: 'Webhook → Proceso → Verificación humana → Guardar', description: 'Recibe un webhook, lo procesa, pide aprobación y guarda el resultado en un archivo.', category: 'Aprobaciones', difficulty: 'Inicial', stepCount: 4, tags: ['webhook', 'aprobación'] },
  { id: 'manual-http-save', name: 'Manual → Llamada HTTP → Guardar', description: 'Disparo manual, hace una llamada HTTP con el payload y guarda el resultado.', category: 'Integraciones', difficulty: 'Inicial', stepCount: 3, tags: ['HTTP', 'archivo'] },
  { id: 'manual-approve-shell', name: 'Manual → Aprobación → Shell', description: 'Disparo manual, pide aprobación y ejecuta un comando shell.', category: 'Automatización', difficulty: 'Inicial', stepCount: 3, tags: ['shell', 'aprobación'] },
  { id: 'github-issue-fix-pr', name: 'Resolución de Issues de GitHub e inyección de PR (AI Agent + Git/PR)', description: 'Recibe un webhook de un Issue de GitHub, usa un Agente de IA para generar el fix, solicita aprobación humana y crea un Pull Request.', category: 'Desarrollo', difficulty: 'Avanzado', stepCount: 5, tags: ['IA', 'GitHub', 'PR'] },
  { id: 'api-scraping-db-save', name: 'Ingesta de API diaria con Scripting y Base de Datos (Cron → HTTP → JS/Python → NoSQL DB)', description: 'Ejecuta un cron diario, consulta una API externa, procesa los datos con JavaScript/Python y los guarda en la base de datos NoSQL local.', category: 'Datos', difficulty: 'Avanzado', stepCount: 4, tags: ['cron', 'API', 'NoSQL'] },
  { id: 'ci-cd-test-rollback', name: 'CI/CD Autónomo con Pruebas y Rollback (Webhook → Shell → Condición → Deploy/Git)', description: 'Se activa por un push, ejecuta pruebas y empaquetado shell, valida el resultado con una condición lógica y realiza un deploy o rollback automático.', category: 'Desarrollo', difficulty: 'Avanzado', stepCount: 5, tags: ['CI/CD', 'rollback'] },
  { id: 'multi-agent-parallel-coding', name: 'Pipeline Multi-Agente en Paralelo (Agente Code + Agente Test → Fusión de Reporte)', description: 'Ejecuta agentes en paralelo para codificar y escribir pruebas simultáneamente, une los resultados y solicita aprobación.', category: 'IA', difficulty: 'Avanzado', stepCount: 6, tags: ['IA', 'paralelo', 'tests'] }
];

// Default configs used when a step is added to the designer palette.
export const DEFAULT_STEP_CONFIGS: Record<StepType, Record<string, any>> = {
  trigger: { triggerType: 'webhook', cronExpression: '0 9 * * 1-5', timezone: 'America/Bogota' },
  normalizer: { mapping: { message: 'triggerPayload.message' } },
  agent: { prompt: 'Diagnose and fix the following issue: {{message}}', agent: 'engineer', provider: 'google', model: 'gemini-3-flash-preview' },
  condition: { expression: 'context.stepOutputs.agent1.success === true', onTrue: '', onFalse: '' },
  shell_test: { command: 'npm test' },
  git: { commitMessage: 'fix: resolving platform error' },
  pr: { title: 'OpenCode Auto-Fix', body: 'Proposed agent code modifications.' },
  transform: { template: 'Report:\n{{context.stepOutputs.agent1.output}}' },
  output: { outputType: 'file', filePath: 'opencode-report.txt', data: '{{context.stepOutputs.transform1.outputText}}' },
  approval: { description: 'Review the changes before committing and running commands.' },
  nosql: { databaseId: '', collection: '', operation: 'find', documentId: '', data: '' },
  http_request: {
    url: 'https://api.example.com/data',
    method: 'GET',
    headers: {},
    body: '',
    authType: 'none',
    bearerToken: ''
  },
  code: {
    language: 'javascript',
    code: '// Escribe tu script aquí\n// Modifica el objeto context y retorna el resultado\nreturn { success: true, payload: context.triggerPayload };'
  },
  parallel: { joinNextStepId: '' },
  loop: { itemsExpr: '', itemVar: 'item', maxIterations: 10 },
  retry: { retries: 3, retryDelayMs: 1000 },
  wait: { durationMs: 5000 },
  discord_notify: { webhookUrl: '', message: 'Hola desde OpenCode! El paso anterior retornó {{context.stepOutputs.prev_step.success}}' },
  google_sheets: { spreadsheetId: '', range: 'Sheet1!A1:D', operation: 'append', values: '' },
  python: { source: 'inline', code: 'result = context["triggerPayload"]', filePath: '', args: '', timeoutMs: 30000 },
  json_parser: { inputExpr: 'context.triggerPayload', operation: 'parse', path: '', rowsPath: '', mapping: {} }
};

// New-project registration form state (lifted to App so it survives tab switches).
export interface ProjectFormState {
  id: string;
  name: string;
  localPath: string;
  gitRemoteUrl: string;
  baseBranch: string;
  allowedCommands: string;
  concurrencyMode: 'serialize' | 'reject';
  maxExecutionTimeSeconds: number;
  requireApprovalForDestructiveActions: boolean;
}

export const EMPTY_PROJECT_FORM: ProjectFormState = {
  id: '',
  name: '',
  localPath: '',
  gitRemoteUrl: '',
  baseBranch: 'main',
  allowedCommands: 'npm test, pytest, echo',
  concurrencyMode: 'serialize',
  maxExecutionTimeSeconds: 600,
  requireApprovalForDestructiveActions: true
};

export type NewWorkflowFormState = Omit<Workflow, 'steps' | 'createdAt' | 'updatedAt'>;

export const EMPTY_NEW_WORKFLOW: NewWorkflowFormState = {
  id: '',
  name: '',
  projectId: '',
  version: 1,
  isActive: true
};

// API reference console endpoints (developer console view).
export interface ApiEndpoint {
  id: string;
  method: string;
  path: string;
  description: string;
  headers: Record<string, string>;
  defaultPayload: string;
  hasParams: boolean;
  params?: string[];
}

export const API_ENDPOINTS: ApiEndpoint[] = [
  {
    id: 'list-workflows',
    method: 'GET',
    path: '/api/workflows',
    description: 'Fetch all workflows currently configured in the state store.',
    headers: { 'Content-Type': 'application/json' },
    defaultPayload: '',
    hasParams: false
  },
  {
    id: 'create-workflow',
    method: 'POST',
    path: '/api/workflows',
    description: 'Create a new agentic workflow graph in the system.',
    headers: { 'Content-Type': 'application/json' },
    defaultPayload: JSON.stringify({
      id: "workflow-example",
      name: "Example Workflow",
      projectId: "",
      version: 1,
      isActive: true,
      steps: [
        {
          id: "trigger_1",
          type: "trigger",
          config: { triggerType: "webhook" },
          nextStepIds: ["agent_1"]
        },
        {
          id: "agent_1",
          type: "agent",
          config: {
            prompt: "Hello world!",
            agent: "engineer",
            provider: "google",
            model: "gemini-3-flash-preview"
          },
          nextStepIds: []
        }
      ]
    }, null, 2),
    hasParams: false
  },
  {
    id: 'update-workflow',
    method: 'PUT',
    path: '/api/workflows/:id',
    description: 'Update/modify an existing workflow graph by ID.',
    headers: { 'Content-Type': 'application/json' },
    params: ['id'],
    defaultPayload: JSON.stringify({
      name: "Updated Workflow Name",
      projectId: "",
      version: 2,
      isActive: true,
      steps: []
    }, null, 2),
    hasParams: true
  },
  {
    id: 'delete-workflow',
    method: 'DELETE',
    path: '/api/workflows/:id',
    description: 'Delete a workflow and clean up its associated triggers.',
    headers: {},
    params: ['id'],
    defaultPayload: '',
    hasParams: true
  },
  {
    id: 'list-projects',
    method: 'GET',
    path: '/api/projects',
    description: 'Fetch all registered projects.',
    headers: {},
    defaultPayload: '',
    hasParams: false
  },
  {
    id: 'create-project',
    method: 'POST',
    path: '/api/projects',
    description: 'Register a new project with local folder path and execution policies.',
    headers: { 'Content-Type': 'application/json' },
    defaultPayload: JSON.stringify({
      id: "project-example",
      name: "Example Project",
      localPath: "C:\\Projects\\example",
      gitRemoteUrl: "git@github.com:example/repo.git",
      baseBranch: "main",
      allowedCommands: ["npm test", "pytest"],
      policy: {
        maxExecutionTimeSeconds: 600,
        concurrencyMode: "serialize",
        requireApprovalForDestructiveActions: true
      }
    }, null, 2),
    hasParams: false
  },
  {
    id: 'list-executions',
    method: 'GET',
    path: '/api/executions',
    description: 'Retrieve workflow run execution history, sorted newest first.',
    headers: {},
    defaultPayload: '',
    hasParams: false
  },
  {
    id: 'trigger-execution',
    method: 'POST',
    path: '/api/executions/trigger',
    description: 'Manually trigger a new workflow run. projectId is optional.',
    headers: { 'Content-Type': 'application/json' },
    defaultPayload: JSON.stringify({
      workflowId: "workflow-example",
      projectId: "",
      payload: {
        message: "Trigger payload parameters"
      }
    }, null, 2),
    hasParams: false
  }
];
