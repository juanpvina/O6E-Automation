# OpenCode Orchestrator v2 — Flujos de automatización + Debug estilo n8n

**Estado:** Aprobado en brainstorming (2026-08-20).
**Alcance:** Evolución de la plataforma hacia un orquestador visual estilo n8n donde se puedan construir flujos de automatización y **debugear** cada ejecución de forma legible, junto con métricas de agente y una base de tests.
**Principio rector:** el usuario quiere "algo estilo n8n: poder debuggear y hacer flujos de automatización". Mantener las garantías de seguridad (merge nunca automático, secretos nunca expuestos, path isolation).

---

## 1. Objetivo

Transformar la plataforma de un editor de workflows "de lista vertical" + consola de texto plano, a un **orquestador visual** donde:

- El **constructor** muestre el flujo como un **grafo de nodos conectados** (estilo n8n) con estado por paso.
- La **vista de runs** permita **debuggear**: nodos con check (ok/error/advertencia/en curso/en espera) y el **contenido legible** de cada paso al seleccionarlo.
- La **respuesta del agente** sea visible y legible (tanto por nodo `agent` como resumen final).
- Se capturen **métricas de agente** (modelo, tokens, costo estimado, duración) por sesión.
- Exista una **suite de tests** que permita refactorizar con seguridad (hoy no hay ninguno).

---

## 2. Decisiones de alcance (acordadas)

| Tema | Decisión |
|------|----------|
| Editor de flujo | **Grafo de lectura + edición actual**. Visualizar el DAG con estado; la edición de pasos sigue en el inspector actual. **Sin** react-flow ni paleta de arrastre (menor riesgo). |
| Métricas de agente | **Parseo de stdout** de `opencode run` (modelo, tokens, costo, duración). Sin depender de un modo JSON de opencode. |
| Diff | **No** se implementa visor de diff real. En su lugar: **panel de respuesta del agente** (final + por nodo agent). |
| Descomposición | `App.tsx` (monolito de ~4558 líneas) se descompone en módulos por dominio. **Habilitador** para que los subagentes trabajen en paralelo sobre archivos disjuntos. |
| Tests | Suite con Vitest (backend y frontend), empezando por las funciones de parseo y helpers de estado/logs. |

---

## 3. Arquitectura

### 3.1 Descomposición de App.tsx (D1) — habilitador

Dividir el monolito bajo `packages/frontend/src/`:

```
src/
  main.tsx
  App.tsx                    # orquestador de pestañas (chico)
  api/
    client.ts                # fetch + endpoints
  hooks/
    useData.ts               # fetch + polling de datos
    useExecutionStream.ts    # SSE + stepEvents + logs
  components/
    StatusBadge.tsx          # badges ok/error/advertencia/en curso/en espera
    ReadonlyJson.tsx         # visor JSON de solo lectura
    JsonNode.tsx             # visor JSON interactivo del editor
    FlowGraph.tsx            # canvas de grafo de lectura
    AgentResponse.tsx        # panel de respuesta del agente
    StepDetailPanel.tsx      # panel lateral de detalle de paso
  views/
    DashboardView.tsx
    WorkflowsView.tsx        # constructor (grafo + inspector)
    ExecutionsView.tsx       # runs/debug
    ConnectionsView.tsx
    SchedulesView.tsx
    SettingsView.tsx
```

**Riesgo:** refactorización grande sin tests existentes.
**Mitigación:** la descomposición se hace en una pasada verificada (build + e2e manual con fixtures) **antes** de lanzar los subagentes de features, que ya editan archivos disjuntos.

### 3.2 Constructor: grafo de lectura + inspector actual (D6-lite)

- En la pestaña Workflows, junto al inspector de pasos existente, un **canvas de grafo** que renderiza el DAG: nodos = pasos, flechas = `nextStepIds`.
- Nodos con check de estado y **selección bidireccional**: click en nodo → edita en el inspector actual; click en el inspector → resalta el nodo.
- **Sin** react-flow: se dibuja con SVG/capas propias (sin dependencia nueva). Zoom/pan básico.
- El inspector de edición actual se mantiene.

### 3.3 Vista de runs/debug (rediseño)

- **Nodos del tracker**: cada uno con **check claro** (✓ ok / ✕ error / ⚠ advertencia / ⟳ en curso / ⏸ en espera) y **contenido del paso legible** al seleccionar (output formateado, no JSON crudo ilegible).
- **Logs integrados**: en lugar de un "cuadrado negro" aislado, los logs se muestran **por paso** dentro del panel de detalle (filtrados por ventana temporal) + un **stream general colapsable** al fondo con mejor jerarquía visual (timestamps, niveles, agrupación por paso).
- **Panel de respuesta del agente**: al seleccionar un nodo `agent`, mostrar la **respuesta completa** de esa sesión (legible). Además, un **resumen final de la respuesta global** al terminar la ejecución.

### 3.4 Métricas de agente (backend)

- `runner.ts` + `executor.ts`: al final de cada paso `agent`, parsear el stdout de `opencode` para extraer **modelo, tokens (input/output), costo estimado, duración**.
- Persistir en un nuevo campo `Execution.agentMetrics` (en `shared/types.ts`).
- Frontend: mostrar estas métricas en el panel de detalle del paso agent y en el resumen de la ejecución.

### 3.5 Suite de tests

- Vitest para backend (runner parseo, executor, store) y frontend (helpers de estado, filtrado de logs, métricas).
- Tests unitarios de: parseo de métricas de agente, `getStepStatuses`, filtrado de logs por paso.

---

## 4. Contrato de datos (shared/types.ts)

Añadir (retrocompatible, opcional):

```typescript
export interface AgentMetrics {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
}

// En Execution:
agentMetrics?: Record<string, AgentMetrics>; // key = stepId (pasos agent)
```

---

## 5. Garantías que no se degradan

- **Nunca** merge automático.
- **Nunca** exponer secretos en prompts, respuestas API ni logs.
- **Nunca** ejecutar comandos fuera del proyecto (path isolation).
- Auth de webhook por defecto compatible con Bearer (retrocompatibilidad).
- Cada ejecución apunta a una versión concreta del workflow.

---

## 6. Estrategia de despliegue de subagentes

Paralelismo seguro = subagentes sobre **archivos disjuntos**. Dado que el frontend es monolito, la descomposición es el paso 0 habilitador.

**Oleada A (paralelo, archivos disjuntos YA):**
| Subagente | Archivos | Tarea |
|-----------|----------|-------|
| S1 — Métricas de agente (backend) | `backend/src/services/runner.ts`, `executor.ts`, `shared/types.ts` | Parseo stdout → `agentMetrics`. |
| S2 — Suite de tests | `packages/backend/**/*.test.ts`, `vitest.config.*`, `package.json` | Tests de parseo, executor, store. |
| S3 — Descomposición App.tsx | `frontend/src/**` (reestructura en módulos) | D1 (habilitador). |

**Oleada B (tras S3, paralelo sobre módulos descompuestos):**
| Subagente | Archivos | Tarea |
|-----------|----------|-------|
| S4 — Grafo de lectura | `frontend/src/components/FlowGraph.tsx`, `views/WorkflowsView.tsx` | D6-lite. |
| S5 — Vista runs/debug | `frontend/src/views/ExecutionsView.tsx`, `components/StepDetailPanel.tsx` | Nodos con check + contenido legible + logs integrados. |
| S6 — Panel respuesta agente | `frontend/src/components/AgentResponse.tsx` | Respuesta por nodo agent + resumen final. |
| S7 — Métricas agente (frontend) | `frontend/src/views/ExecutionsView.tsx`, `components/StepDetailPanel.tsx` | Mostrar `agentMetrics`. |

---

## 7. Criterios de aceptación

- `npm run build` (todos los paquetes) sin errores de TypeScript.
- App.tsx descompuesto en módulos; cada feature en su archivo.
- Constructor muestra el DAG como grafo con estado y selección bidireccional.
- Vista de runs: nodos con check claro y contenido legible por paso; logs integrados.
- Respuesta del agente visible por nodo y como resumen final.
- Métricas de agente (modelo/tokens/costo/duración) persistidas y mostradas.
- Suite de tests en ejecución (`npm test`) con casos de parseo y helpers.
- Regresión: workflow de prueba end-to-end (trigger → approval → shell_test → output) sigue funcionando.
