# Spec Fase 4 — Observabilidad + timeline estructurado

**Fecha:** 2026-08-20 | **Proyecto:** OpenCode Orchestrator | **Roadmap:** Fase 4
**Estado:** Aprobado — listo para implementar

## 1. Objetivo
Persistir métricas de ejecución, exponer salud del sistema y reemplazar el timeline derivado por regex con eventos de estado estructurados.

## 2. Alcance

| ID | Mejora | Archivos |
|----|--------|----------|
| E1 | Métricas de ejecución (duración por paso, tasa éxito, costo/uso de modelos) | `executor.ts`, `server.ts`, `store.ts` |
| E2 | Dashboard/endpoint de salud (jobs, cola, errores) | `server.ts`, `queue.ts`, `App.tsx` |
| E3 | Evento de estado por paso estructurado (no regex) | `executor.ts`, `server.ts`, `types.ts`, `App.tsx` |

## 3. Diseño

### E1 — Métricas
- Registrar en cada ejecución/ejecución de paso: `stepName`, `startedAt`, `durationMs`, `outcome`.
- Nuevo campo en `Execution`: `stepTimings?: { stepId: string; type: string; startedAt: string; durationMs: number; outcome: 'success'|'failed'|'skipped' }[]`.
- Para agentes, registrar `model`/`provider` usados (permite costo/uso). Persistir en una colección `metrics` o dentro de la ejecución.
- Endpoint `GET /api/metrics` para agregados (duración promedio por paso, tasa de éxito, uso por modelo).

### E2 — Salud del sistema
- `GET /api/health`: estado del scheduler (jobs activos), cola por proyecto (activo + profundidad), última vez que se procesó, errores recientes.
- En el frontend, un indicador de salud (dashboard).

### E3 — Eventos de estado por paso
- `WorkflowExecutor` emite un evento `step` con `{ executionId, stepId, type, status: 'started'|'finished'|'failed'|'waiting_approval', ts }`.
- El SSE `logs/stream` emite `event: step` además de `log`/`status`.
- El frontend usa estos eventos para construir el timeline en vez de parsear regex de logs.

## 4. Aceptación
- `GET /api/metrics` devuelve agregados correctos.
- `GET /api/health` refleja cola y scheduler reales.
- El timeline del frontend usa eventos `step`, no regex.
- `npm run build` sin errores.
