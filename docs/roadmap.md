# OpenCode Orchestrator — Roadmap de Mejora y Evolución

**Estado:** Aprobado en brainstorming (2026-08-20). Documento vivo.
**Alcance:** Rework y evolución de la plataforma local de orquestación de workflows de agentes OpenCode.
**Principio rector:** pequeñas unidades con una única responsabilidad, interfaces estables, y nunca degradar las garantías de seguridad existentes (merge nunca automático, secretos nunca expuestos, comandos nunca fuera del proyecto).

---

## 1. Resumen

La plataforma ya implementa un orquestador local (backend Express + TypeScript, frontend React + Vite, monorepo npm workspaces) con:

- Workflows como grafo dirigido de pasos (trigger, normalizer, agent, condition, shell_test, git, pr, transform, output, approval).
- Cola por proyecto (serialización), scheduler cron, webhooks Bearer, secretos AES-GCM, git/PR vía CLI.
- Frontend de 5 pestañas con editor de workflows, ejecuciones con logs SSE en vivo, aprobaciones y dashboard.

Este roadmap detalla las mejoras por fases, cada una desplegable con subagentes en paralelo sobre **archivos disjuntos** para evitar conflictos.

---

## 2. Inventario de mejoras (hallazgos → acción)

Referencias archivo:línea corresponden al estado actual antes del rework.

### A. Robustez y confiabilidad (backend)
| ID | Hallazgo | Acción |
|----|----------|--------|
| A1 | Webhooks sin idempotencia: cada POST autenticado crea una ejecución nueva (`executor.ts:142`). | Dedup por clave de evento (hash de payload + connectionId) con TTL. |
| A2 | Un paso fallido aborta todo el workflow (`executor.ts:277-285`). | Reintentos configurables por nodo + política de error por paso. |
| A3 | Sin auditoría de transiciones (causa/actor/timestamp) (`executor.ts:71-76`). | Registro inmutable `statusHistory` en cada `Execution`. |
| A4 | `running`/`queued` quedan colgadas al reiniciar; la cola es solo memoria (`queue.ts`). | Reconciliación `recoverStale()` al arranque. |
| A5 | El timeout de la cola rechaza el Promise pero no mata el proceso hijo (`queue.ts:35-40`) → solapamiento. | AbortController + kill del árbol de procesos. |
| A6 | `fs.writeFile` directo sin escritura atómica (`store.ts:37-42`) → corrupción. | Write-to-temp + rename. |
| A7 | Read-modify-write no atómico, races multi-instancia (`store.ts:44-51`). | Operaciones atómicas/CAS con versión. |

### B. Seguridad y aislamiento
| ID | Hallazgo | Acción |
|----|----------|--------|
| B1 | Webhook solo Bearer estático, sin HMAC/timestamp/nonce/replay (`server.ts:156-189`). | Modo de autenticación configurable: Bearer \| HMAC (timestamp+nonce+expiración) \| token rotado por conexión. |
| B2 | API `/api/*` sin autenticación. | Token de acceso local para el frontend. |
| B3 | `new Function` sin sandbox en condiciones (`executor.ts:669-678`). | Evaluador de expresiones restringido. |
| B4 | Redacción de secretos incompleta y costosa (solo `agent` del proyecto target, list+decrypt por línea, `executor.ts:772-785`). | Redactar en shell/git/errores; cachear secretos; umbral correcto. |
| B5 | `git.ts` con `shell:true` e interpolación (`git.ts`), push/PR fallan en silencio o generan PR mock (`git.ts:101-104,139-160`). | Spawn con args estructurados, desactivar mock en producción, errores explícitos. |

### C. Funcionalidad de workflows
| ID | Hallazgo | Acción |
|----|----------|--------|
| C1 | Ejecutor lineal (`executor.ts:230-267`), sin nodos paralelo/loop/retry. | Nodos `parallel` (fork/join), `loop`, `retry`, `wait`. |
| C2 | Expresiones limitadas; `TemplateField` interpola `{{...}}` pero sin lógica. | Expresiones más ricas (ternarios, transformaciones) en prompts y condiciones. |
| C3 | `output` solo file real; http con fetch limitado; firebase es mock (`executor.ts:637-639`). | Output adapters reales: webhook saliente, Firebase, notificaciones. |

### D. Frontend
| ID | Hallazgo | Acción |
|----|----------|--------|
| D1 | `App.tsx` monolítico de 3850 líneas. | Descomposición en módulos/components + hooks de datos. |
| D2 | Sin vistas dedicadas de Conexiones, Schedules, Agentes, Salidas. | Vistas CRUD dedicadas (server ya expone endpoints). |
| D3 | Sin diffs en la vista de ejecución. | Mostrar diff git/código. |
| D4 | Policy hardcodeada en la UI (`App.tsx:1592-1596`). | Formulario de policy (concurrency/timeout/approval). |
| D5 | Secrets: solo crear, no listar/borrar en la UI. | Gestión completa de secrets. |
| D6 | Constructor visual es lista vertical + inspector, no grafo. | Evaluar grafo arrastrable (react-flow). |

### E. Observabilidad y métricas
| ID | Hallazgo | Acción |
|----|----------|--------|
| E1 | Sin métricas de ejecución (duración por paso, tasa éxito, costo/uso de modelos). | Métricas y persistencia. |
| E2 | Sin dashboard de salud (jobs, cola, errores). | Vista de salud del sistema. |
| E3 | Timeline derivado por regex frágil (`App.tsx:1390-1480`). | Evento de estado por paso estructurado desde backend. |

### F. Portabilidad / multi-ambiente
| ID | Hallazgo | Acción |
|----|----------|--------|
| F1 | Cola/scheduler solo en memoria. | Backend durable (persistencia de cola, catch-up de cron). |
| F2 | Interfaces definidas pero sin adaptadores remotos. | Workers remotos, store externo, despliegue Cloud Run/VPS. |

### G. Entorno interactivo de OpenCode
| ID | Hallazgo | Acción |
|----|----------|--------|
| G1 | El operador no puede preparar OpenCode desde el dashboard por proyecto. | Terminal local interactiva mediante PTY, con configuración reutilizable y sesiones conversacionales no persistidas. |
| G2 | El runtime local no tiene todavía una estrategia de aislamiento por proyecto. | Evolución posterior: contenedor OpenCode compartido con carpetas separadas y, si hace falta, contenedores aislados. |

---

## 3. Fases (orden = dependencias + valor)

### Fase 1 — Cimientos de robustez (backend)
Contiene: **A1** idempotencia, **A2** reintentos por paso, **A4** recuperación tras reinicio + cola durable + kill de procesos (**A5**), **A6** escritura atómica, **A7** CAS. Además **B1** auth de webhook configurable (Bearer/HMAC/tokens rotados) — pedido explícito.

Dependencias: ninguna. Es la base de todo lo demás. No rompe el contrato de la UI.

### Fase 2 — Seguridad restante + git
Contiene: **B2** auth API, **B3** sandbox de condiciones, **B4** redacción completa, **B5** git.ts endurecido.

### Fase 3 — Funcionalidad de workflows
Contiene: **C1** nodos paralelo/loop/retry/wait, **C2** expresiones, **C3** output adapters.

### Fase 4 — Observabilidad + timeline estructurado
Contiene: **E1**, **E2**, **E3**.

### Fase 5 — Frontend
Contiene: **D1** descomposición, **D2** vistas, **D3** diffs, **D4** policy UI, **D5** secrets UI, **D6** constructor.

### Fase 6 — Portabilidad
Contiene: **F1**, **F2**.

### V1 — Configuración interactiva de OpenCode
La terminal local por proyecto se implementará como una capacidad separada del `IOpenCodeRunner`: el operador configura proveedores, modelos, agentes, skills y MCP en un PTY asociado al `localPath`. Los workflows siguen usando `opencode run` en sesiones nuevas y no guardan `sessionId` para continuidad conversacional.

La especificación completa está en `docs/superpowers/specs/2026-08-22-opencode-configured-terminal-v1-design.md`. Como evolución de F2 se documentan un contenedor único con `/workspace/<projectId>` y, posteriormente, contenedores aislados por proyecto o ejecución.

---

## 4. Despliegue de subagentes (por fase)

Cada fila es un subagente independiente que trabaja en archivos disjuntos. Se ejecutan en paralelo dentro de la fase.

### Fase 1 (paralelo)
| Subagente | Archivos | Tareas |
|-----------|----------|--------|
| F1a — Idempotencia + reintentos | `executor.ts`, `server.ts`, `types.ts` | A1 dedup por clave de evento con TTL; A2 reintentos configurables por nodo. |
| F1b — Recuperación + cola durable + kill | `queue.ts`, `index.ts`, `executor.ts` | A4 `recoverStale()`; A5 kill de árbol de procesos en timeout. |
| F1c — Store atómico + CAS | `store.ts`, `types.ts` | A6 escritura atómica; A7 operaciones atómicas con versión. |
| F1d — Auth de webhook configurable | `server.ts`, `types.ts`, `shared` | B1 Bearer/HMAC/tokens rotados por conexión. |

### Fase 2 (paralelo)
| Subagente | Archivos | Tareas |
|-----------|----------|--------|
| F2a — Auth de API | `server.ts`, `index.ts` | B2 token de acceso local. |
| F2b — Sandbox de condiciones | `executor.ts` | B3 evaluador de expresiones restringido. |
| F2c — Redacción de secretos | `executor.ts`, `secrets.ts` | B4 redacción completa + caché. |
| F2d — git.ts endurecido | `git.ts` | B5 spawn con args, sin mock, errores explícitos. |

### Fase 3 (paralelo)
| Subagente | Archivos | Tareas |
|-----------|----------|--------|
| F3a — Motor de ejecución no lineal | `executor.ts`, `types.ts` | C1 nodos parallel/loop/retry/wait. |
| F3b — Expresiones | `executor.ts`, `App.tsx` | C2 expresiones más ricas. |
| F3c — Output adapters | `executor.ts`, `types.ts` | C3 webhook saliente, Firebase, notificaciones. |

### Fase 4 (paralelo)
| Subagente | Archivos | Tareas |
|-----------|----------|--------|
| F4a — Métricas | `executor.ts`, `server.ts`, `store.ts` | E1 métricas de ejecución. |
| F4b — Salud del sistema | `server.ts`, `queue.ts` | E2 endpoint/vista de salud. |
| F4c — Eventos de estado estructurados | `executor.ts`, `server.ts`, `types.ts`, `App.tsx` | E3 evento de estado por paso. |

### Fase 5 (paralelo)
| Subagente | Archivos | Tareas |
|-----------|----------|--------|
| F5a — Descomposición de App.tsx | `frontend/src/*` | D1 módulos + hooks. |
| F5b — Vistas Conexiones/Schedules/Agentes/Salidas | `frontend/src/*` | D2. |
| F5c — Diffs | `frontend/src/*` | D3. |
| F5d — Policy UI | `frontend/src/*` | D4. |
| F5e — Secrets UI | `frontend/src/*` | D5. |
| F5f — Constructor visual | `frontend/src/*` | D6. |

### Fase 6 (paralelo)
| Subagente | Archivos | Tareas |
|-----------|----------|--------|
| F6a — Cola/scheduler durable | `queue.ts`, `scheduler.ts` | F1. |
| F6b — Adaptadores remotos | `shared`, `services` | F2. |

---

## 5. Garantías que no se deben degradar

- **Nunca** merge automático.
- **Nunca** exponer secretos en prompts, respuestas API ni logs.
- **Nunca** ejecutar comandos fuera del proyecto (path isolation).
- La terminal interactiva debe resolver el proyecto por `projectId`; nunca aceptar un `cwd` arbitrario desde el navegador o webhook.
- La auth de webhook por defecto debe seguir siendo compatible con Bearer (retrocompatibilidad).
- Cada ejecución apunta a una versión concreta del workflow; editar no altera ejecuciones históricas.

## 6. Criterios de aceptación por fase

- **Fase 1:** un webhook duplicado no crea dos ejecuciones; una ejecución `running`/`queued` se reconcilia al reiniciar; un timeout mata el proceso hijo; no hay JSON corrupto tras cortes; la auth de webhook soporta Bearer y HMAC.
- **Fase 2:** `/api/*` requiere token; condiciones sin acceso a globals peligrosos; secretos redactados en todos los logs; git sin inyección y sin PR mock.
- **Fase 3:** workflows con ramas paralelas, loops y reintentos; output a webhook externo y Firebase reales.
- **Fase 4:** métricas persistidas; dashboard de salud; timeline por eventos estructurados.
- **Fase 5:** App.tsx descompuesto; vistas CRUD de conexiones/schedules/agentes/salidas; diffs; policy y secrets gestionables.
- **Fase 6:** cola/scheduler durables; adaptadores remotos opcionales.

## 7. Verificación

Cada fase debe terminar con:
- `npm run build` (todos los paquetes) sin errores de TypeScript.
- Ejecución manual de un workflow de prueba (end-to-end).
- Regresión: los flujos existentes (webhook → diagnóstico → PR) siguen funcionando.
