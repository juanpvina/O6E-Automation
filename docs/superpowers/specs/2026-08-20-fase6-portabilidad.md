# Spec Fase 6 — Portabilidad / multi-ambiente

**Fecha:** 2026-08-20 | **Proyecto:** OpenCode Orchestrator | **Roadmap:** Fase 6
**Estado:** Aprobado — listo para implementar

## 1. Objetivo
Hacer durable la cola y el scheduler y preparar el despliegue a VPS/Cloud Run con adaptadores remotos.

## 2. Alcance

| ID | Mejora | Archivos |
|----|--------|----------|
| F1 | Cola/scheduler durable (persistencia de cola, catch-up de cron) | `queue.ts`, `scheduler.ts` |
| F2 | Adaptadores remotos (workers remotos, store externo, Cloud Run) | `shared`, `services/*` |

## 3. Diseño

### F1 — Persistencia de cola y scheduler
- Persistir la cola en el `IStateStore` (nueva colección `queue`) de modo que las ejecuciones `queued` sobrevivan a un reinicio y se procesen al arrancar (complementa A4 de Fase 1).
- Scheduler: calcular y persistir `nextRunAt`; añadir catch-up de triggers cron perdidos mientras el proceso estuvo caído (ejecutar la corrida omitida si `missedCatchup: true` en la conexión/step).

### F2 — Adaptadores remotos
- Implementar alternativas a las implementaciones locales, tras las interfaces existentes:
  - `IStateStore` → adaptador a base de datos externa (Firestore / Postgres) para Cloud Run.
  - `IOpenCodeRunner` → runner remoto (worker en otro host).
  - `IGitProvider` → GitLab/Bitbucket.
  - `ISecretStore` → Secret Manager.
- Mantener el comportamiento local por defecto; los adaptadores remotos se activan por configuración.
- El orquestador debe permanecer stateless en Cloud Run (fuente de verdad externa), con scheduler/cola resueltos explícitamente.

### Evolución del runtime OpenCode

La V1 no requiere un contenedor OpenCode: utiliza una terminal local interactiva por proyecto para configurar el runtime y mantiene las ejecuciones automáticas en `opencode run` con sesiones nuevas.

Como evolución compatible con F2 se contemplan dos niveles:

1. Un contenedor OpenCode compartido para todos los proyectos, con cada workspace bajo `/workspace/<projectId>` y configuración `.opencode` por carpeta.
2. Contenedores aislados por proyecto o ejecución cuando sean necesarios límites fuertes de filesystem, red, CPU/RAM o concurrencia.

En ambos casos, la configuración del runtime no sustituye al `IStateStore` como fuente de verdad del orquestador y no se introduce persistencia obligatoria de `sessionId`.

## 4. Aceptación
- Una ejecución `queued` sobrevive a un reinicio y se procesa.
- Un cron caído recupera la corrida omitida si está habilitado.
- Se puede seleccionar un adaptador remoto por interfaz mediante configuración.
- `npm run build` sin errores; el modo local sigue funcionando.
