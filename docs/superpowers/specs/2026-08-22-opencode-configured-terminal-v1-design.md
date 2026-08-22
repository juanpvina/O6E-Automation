# OpenCode configurado por proyecto — Diseño V1

**Fecha:** 2026-08-22  
**Estado:** Decisión aprobada para implementación posterior  
**Alcance:** Terminal interactiva local para preparar OpenCode por proyecto

## 1. Decisión

La V1 añadirá una terminal interactiva local, accesible desde un modal del frontend, para abrir OpenCode con el `localPath` del proyecto seleccionado.

El operador podrá configurar OpenCode manualmente desde esa terminal, incluyendo autenticación de proveedores, selección de modelo/agente, agentes, skills y MCP. La configuración queda disponible para las siguientes ejecuciones del proyecto.

La sesión conversacional de la terminal es efímera para el orquestador: **no se persiste ni se reutiliza `sessionId`**. Las ejecuciones automáticas del workflow siempre crean una sesión nueva y no dependen del historial conversacional de la terminal.

## 2. Alcance de V1

### Incluido

- Acción “Abrir consola OpenCode” por proyecto.
- Modal con terminal interactiva real mediante PTY, no un `spawn` de stdout plano.
- Proceso iniciado con `cwd` igual al `localPath` validado del proyecto.
- Configuración manual mediante los mecanismos propios de OpenCode: `/connect`, modelos, agentes, skills y MCP.
- Reutilización de la configuración del proyecto por el runner no interactivo.
- Cierre y limpieza controlada del proceso PTY.
- Redimensionamiento y transmisión bidireccional de entrada/salida entre modal y backend.

### No incluido

- Persistencia o reanudación de conversaciones.
- Guardar `sessionId` en `Execution`, `Workflow` o `IStateStore`.
- Compartir una sesión interactiva con un nodo `agent`.
- Abrir una shell arbitraria fuera del proyecto.
- Docker por proyecto o contenedor remoto en la V1.

## 3. Separación de conceptos

| Concepto | V1 |
|---|---|
| Configuración de OpenCode | Persistente según los archivos y almacenamiento local de OpenCode |
| Conversación de la terminal | Efímera para el orquestador |
| Sesión de cada `opencode run` | Nueva e independiente |
| Estado de workflow | Persistido por el orquestador |
| Logs, resultados y artefactos | Persistidos según `IStateStore` y las políticas existentes |
| Credenciales | Gestionadas por OpenCode o secretos protegidos; nunca en prompts/logs |

“No persistir sesiones” significa no usar la sesión conversacional como mecanismo de continuidad. No significa eliminar el historial de ejecuciones del orquestador.

## 4. Configuración por proyecto

El proceso interactivo se abre dentro de la carpeta registrada en `Project.localPath`. La configuración específica del proyecto debe preferir archivos dentro de esa carpeta:

```text
<localPath>/
└── .opencode/
    ├── opencode.json
    ├── agents/
    └── skills/
```

Las credenciales de proveedores y otros datos globales de OpenCode pueden residir en el almacenamiento de usuario del runtime. No deben copiarse a la base de datos del orquestador ni incluirse en workflows, prompts, respuestas API o logs.

Cuando una preferencia no tenga una persistencia declarativa fiable, el nodo `agent` podrá recibir un override explícito (`model`/`agent`). La configuración del terminal nunca debe ser una suposición oculta sobre otro proyecto.

## 5. Flujo de V1

```text
Usuario selecciona proyecto
  → frontend solicita terminal OpenCode
  → backend valida proyecto y localPath
  → backend crea PTY con cwd=localPath
  → modal transmite teclado, resize y salida
  → usuario configura OpenCode
  → usuario cierra el terminal
  → workflow posterior ejecuta `opencode run` nuevo
  → OpenCode lee la configuración del proyecto
```

El runner automático seguirá siendo no interactivo y conservará su contrato `IOpenCodeRunner.run`. La terminal es una capacidad separada de preparación y no convierte el runner de workflows en una shell interactiva.

## 6. Seguridad y aislamiento

- El frontend solicita al backend abrir, escribir, redimensionar y cerrar una terminal autorizada; nunca ejecuta comandos directamente.
- El backend resuelve el proyecto por `projectId`; no acepta un `cwd` arbitrario desde navegador o webhook.
- El `cwd` debe ser exactamente `localPath` o una ruta descendiente validada según la política del proyecto.
- El endpoint de terminal debe estar protegido por la autenticación local del frontend.
- No se debe habilitar `shell: true` como sustituto de PTY ni concatenar comandos recibidos del cliente.
- La V1 permanece en localhost y no expone el terminal públicamente.
- Las salidas del terminal no se persisten automáticamente en logs de ejecución.
- El proceso PTY y sus hijos terminan al cerrar la terminal, cancelar el proyecto o apagar el backend.

## 7. Implementación prevista

La implementación local requiere una abstracción separada del runner:

```ts
interface IOpenCodeTerminal {
  open(projectId: string): Promise<{ terminalId: string }>;
  write(terminalId: string, input: string): Promise<void>;
  resize(terminalId: string, cols: number, rows: number): Promise<void>;
  close(terminalId: string): Promise<void>;
}
```

La implementación inicial usará un PTY local, previsiblemente mediante `node-pty`, y transporte WebSocket entre frontend y backend. Los detalles de endpoints y UI se definirán durante la implementación.

El `IOpenCodeRunner` no debe asumir que existe una terminal abierta. Un workflow debe funcionar aunque el proyecto nunca haya abierto el modal.

## 8. Evolución documentada

### V2 — Un contenedor OpenCode compartido

Un solo contenedor puede alojar todos los proyectos bajo rutas separadas:

```text
/workspace/<projectId>/
```

La terminal y los runners elegirían el `cwd` correspondiente. La configuración `.opencode` permanecería por proyecto. Esto requiere resolver montaje de repositorios, persistencia de configuración, lifecycle del contenedor, red, recursos y traducción entre paths host/contenedor.

Este modelo separa proyectos lógicamente, pero no proporciona aislamiento fuerte si todos los procesos usan el mismo usuario del contenedor.

### V3 — Contenedores aislados

Se podrá seleccionar un contenedor por proyecto o por ejecución cuando sean necesarios aislamiento fuerte, límites de CPU/memoria, red restringida o concurrencia independiente. La implementación debe conservar las interfaces de dominio y no hacer de una sesión OpenCode la fuente de verdad.

### Reglas para ambas evoluciones

- El estado de workflows continúa en `IStateStore`.
- Los `sessionId` de OpenCode no son parte del contrato de continuidad del orquestador.
- Los runners locales y remotos conservan path isolation, redacción de secretos y ausencia de merge automático.
- El transporte remoto debe autenticarse y no exponerse públicamente por defecto.

## 9. Criterios de aceptación

1. El operador puede abrir OpenCode desde un proyecto concreto.
2. El proceso inicia en el `localPath` correcto y no acepta rutas arbitrarias.
3. El operador puede introducir comandos interactivos y ver la salida en tiempo real.
4. Skills, agentes, MCP y preferencias configuradas quedan disponibles para nuevas ejecuciones del mismo proyecto.
5. Cada ejecución automática inicia una sesión nueva sin consultar ni guardar un `sessionId` de continuidad.
6. Cerrar el modal termina el proceso PTY y sus hijos.
7. Los secretos no aparecen en API, prompts ni logs persistidos.
8. El runner no interactivo existente sigue funcionando sin abrir el modal.
