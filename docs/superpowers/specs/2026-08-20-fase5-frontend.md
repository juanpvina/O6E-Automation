# Spec Fase 5 — Frontend

**Fecha:** 2026-08-20 | **Proyecto:** OpenCode Orchestrator | **Roadmap:** Fase 5
**Estado:** Aprobado — listo para implementar

## 1. Objetivo
Descomponer el `App.tsx` monolítico (3850 líneas), añadir vistas dedicadas y cerrar gaps de UI (policy, secrets, diffs, constructor).

## 2. Alcance

| ID | Mejora | Archivos |
|----|--------|----------|
| D1 | Descomposición de App.tsx en módulos/components + hooks | `packages/frontend/src/*` |
| D2 | Vistas CRUD de Conexiones, Schedules, Agentes, Salidas | `packages/frontend/src/*` |
| D3 | Diffs git/código en la vista de ejecución | `packages/frontend/src/*` |
| D4 | UI de policy (concurrency/timeout/approval) | `packages/frontend/src/*` |
| D5 | Gestión completa de secrets (listar/borrar) | `packages/frontend/src/*` |
| D6 | Constructor visual: evaluar grafo arrastrable | `packages/frontend/src/*` |

## 3. Diseño

### D1 — Descomposición
- Mover el estado global de `App` a hooks: `useProjects`, `useWorkflows`, `useExecutions`, `useConnections`, `useSchedules`, `useSecrets`, `useRealtimeLogs` (SSE).
- Dividir por vistas en `components/`: `Dashboard/`, `Projects/`, `Workflows/` (builder), `Executions/`, `Connections/`, `Schedules/`, `ApiReference/`.
- Mantener el comportamiento y endpoints actuales (no romper flujo).

### D2 — Vistas dedicadas
- **Conexiones:** lista con estado, rotación de secreto/token, alta/baja (usa `GET/POST/DELETE /api/connections`).
- **Schedules:** lista, expresión cron, timezone, próxima ejecución, pausa (usa `GET/POST/PUT/DELETE /api/schedules`).
- **Agentes:** catálogo de roles/prompts/modelos por proyecto (config), no ejecuta nada.
- **Salidas:** configuración de adaptadores de salida.

### D3 — Diffs
- En la vista de ejecución, mostrar diff del branch/commit del workflow (endpoint backend `GET /api/executions/:id/diff` que ejecuta `git diff` o `git show`) con un visor simple.

### D4 — Policy UI
- En el formulario de proyecto, exponer `concurrencyMode`, `maxExecutionTimeSeconds`, `requireApprovalForDestructiveActions` (hoy hardcodeados, `App.tsx:1592-1596`).

### D5 — Secrets UI
- Listar nombres de secrets por proyecto (nunca valores) y borrar (usa `DELETE /api/projects/:projectId/secrets/:key`).

### D6 — Constructor visual
- Evaluar e integrar un grafo arrastrable (react-flow) manteniendo el modelo `nextStepIds`; si es muy invasivo, conservar el builder por lista e introducir el grafo como vista opcional.

## 4. Aceptación
- `npm run build` sin errores.
- Las 5 pestañas actuales siguen funcionando tras la descomposición.
- Vistas CRUD de conexiones/schedules/agentes/salidas operativas.
- Policy y secrets gestionables desde la UI.
- Diffs visibles en la ejecución.
