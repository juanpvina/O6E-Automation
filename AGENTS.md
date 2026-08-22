# AGENTS.md — Guía de trabajo para agentes

Guía para agentes (humanos y de IA) que trabajan en **OpenCode Orchestrator**, una plataforma local de orquestación de workflows de agentes OpenCode.

## Qué es este proyecto

Un monorepo (npm workspaces) que orquesta workflows de agentes de código de forma local y offline:

- **`packages/backend`** — Orquestador Express/TypeScript: workflows, cola por proyecto, scheduler cron, webhooks, secretos AES-GCM, git/PR.
- **`packages/frontend`** — Dashboard React + Vite + Tailwind + lucide-react.
- **`packages/shared`** — Tipos e interfaces compartidas (incluye la capa de portabilidad).
- **`docs/`** — Arquitectura (`arquitectura-agentes-triggers.md`), spec de diseño (`superpowers/specs/`) y este roadmap (`roadmap.md`).

## Comandos

```bash
npm run build                 # Compila shared, backend y frontend
npm run dev                   # Backend + frontend en dev (concurrently)
npm run dev -w @opencode/backend
npm run dev -w @opencode/frontend
```

El backend corre por defecto en `http://127.0.0.1:3001` (solo localhost). Ver `API_DOCUMENTATION.md`.

## Arquitectura y decisiones clave (NO revertir)

- **Merge automático: NUNCA.** El worker puede crear branch, commit y PR, pero jamás hacer merge.
- **Secretos: NUNCA** en prompts, respuestas API ni logs. Se almacenan cifrados (AES-256-GCM) y se redactan en logs.
- **Path isolation:** los comandos y ediciones solo operan dentro del `localPath` del proyecto.
- **Concurrencia:** una ejecución activa por proyecto; el resto en cola (serializada).
- **Workflow = grafo dirigido de pasos.** Cada ejecución apunta a una versión concreta del workflow (editar no altera ejecuciones históricas).
- **Portabilidad:** la lógica de negocio interactúa con `IStateStore`, `IOpenCodeRunner`, `IGitProvider`, `ISecretStore` — nunca con implementaciones concretas. Respetar estas interfaces.

## Dónde vive cada cosa

| Área | Archivo |
|------|---------|
| Motor de ejecución (pasos, transiciones, aprobaciones) | `packages/backend/src/services/executor.ts` |
| Cola por proyecto | `packages/backend/src/services/queue.ts` |
| Persistencia local | `packages/backend/src/services/store.ts` |
| Runner de OpenCode | `packages/backend/src/services/runner.ts` |
| Scheduler cron | `packages/backend/src/services/scheduler.ts` |
| Git/PR | `packages/backend/src/services/git.ts` |
| Secretos | `packages/backend/src/services/secrets.ts` |
| Endpoints HTTP + webhook | `packages/backend/src/server.ts` |
| Punto de entrada | `packages/backend/src/index.ts` |
| Tipos e interfaces | `packages/shared/src/types.ts` |
| Frontend (monolítico hoy) | `packages/frontend/src/App.tsx` |

## Tipos de paso soportados por el motor

`trigger`, `normalizer`, `agent`, `condition`, `shell_test`, `git`, `pr`, `approval`, `transform`, `output` (definidos en `shared/types.ts` → `StepType`).

## Convenciones de código

- TypeScript estricto; tipos compartidos en `@opencode/shared`, nunca duplicados.
- Cambios que alteren el contrato de datos de `shared` deben actualizar backend, frontend y la UI del editor.
- `spawn` con **args estructurados** (arrays), no cadenas concatenadas con shell — evita inyección.
- Escrituras a disco: preferir atómicas (write-to-temp + rename).
- Logs: redactar secretos; niveles `info | warn | error`.

## Cómo hacer cambios seguros

1. Lee `docs/roadmap.md` y el spec de diseño antes de tocar arquitectura.
2. Respeta las interfaces de portabilidad (`IStateStore`, etc.).
3. Mantén las garantías de seguridad (sección "Garantías que no se deben degradar" del roadmap).
4. Después de editar: `npm run build` y prueba un workflow end-to-end.
5. No reviertas trabajo ajeno; edita de forma incremental y acotada.

## Testing

El proyecto aún no tiene suite de tests automatizada. Verifica los cambios con `npm run build` (sin errores de TS) y con ejecuciones manuales de workflows de prueba (ver `packages/backend/db/` para ejemplos de fixtures: `test-project.json`, `test-workflow.json`).
