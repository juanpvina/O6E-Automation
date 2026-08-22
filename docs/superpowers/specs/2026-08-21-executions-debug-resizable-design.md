# OpenCode Orchestrator — Debug Panel Resizable & Hot Reload Spec

**Estado:** Aprobado en brainstorming (2026-08-21).
**Alcance:** Optimización de usabilidad del panel de ejecuciones, integración de pestañas de configuración editables ("Hot Editing") para corregir flujos en caliente, y soporte para re-ejecución selectiva desde el nodo modificado hacia adelante.

---

## 1. Objetivo y Usabilidad

El desarrollador utiliza OpenCode Orchestrator de manera iterativa. Para evitar fricciones al depurar flujos, es crítico:
1. **Evitar desbordamientos y cortes visuales (Scrollbars redundantes):** El panel de ejecuciones y el editor de flujos deben comportarse como aplicaciones de pantalla completa (*full-height layout*), donde los scrolls ocurren de forma interna en cada panel.
2. **Habilitar áreas de trabajo redimensionables (Resizable Panels):** El usuario debe poder arrastrar bordes para ajustar la altura del grafo y el ancho del panel de detalle.
3. **Hot-Editing de Configuración:** Posibilitar la edición de la configuración original del nodo (como prompts, scripts y comandos) directamente en el panel de detalle de la ejecución, guardando los cambios de forma instantánea al workflow.
4. **Re-ejecución Selectiva (Rewind & Resume):** Poder re-correr la ejecución desde un nodo en particular hacia adelante, conservando los resultados de los nodos previos sin tener que volver a ejecutarlos de cero (ahorrando tiempo y costos de tokens de IA).

---

## 2. Decisiones Clave de Diseño

### 2.1 Caching y Offline-First (Near-Offline)
* **Principio:** No recargar la información de Firebase/Store en cada render o cambio de pestaña. La aplicación usará los datos cacheados localmente en el hook principal de React.
* **Refrescos manuales:** El botón general de "Actualizar" sincronizará los estados de la base de datos a petición del usuario.
* **Persistencia de Layout:** Los valores de altura del grafo (`graphHeight`) y anchura del inspector (`inspectorWidth`) se guardarán en `localStorage` del navegador para persistir entre recargas y cambios de vista.

### 2.2 Re-ejecución Selectiva (Rewind & Resume en Caliente)
* ** snapshots previos:** En el motor (`executor.ts`), cada vez que un nodo se ejecuta de manera exitosa, el motor persistirá en `execution.debugSnapshots[stepId]` la imagen del contexto inmediatamente *anterior* a la corrida de dicho nodo (con los `stepOutputs` acumulados hasta ese instante).
* **Flujo de Re-ejecución:**
  1. El desarrollador edita el prompt/configuración de un nodo y hace clic en **"Guardar en el Workflow"** (en la nueva pestaña "Config" de la ejecución).
  2. En el panel lateral, el desarrollador hace clic en **"Re-ejecutar desde este paso"** (o un botón play secundario en el nodo del grafo/inspector).
  3. El frontend llama a un nuevo endpoint `POST /api/executions/:id/rewind` enviando `{ stepId }`.
  4. El backend:
     - Carga la ejecución.
     - Restaura el estado desde `execution.debugSnapshots[stepId]` (sobreescribiendo `stepOutputs` al punto previo).
     - Limpia los registros de `stepTimings` y `agentMetrics` posteriores a `stepId`.
     - Establece el estado de la ejecución como `running` (o `queued`).
     - Inserta el campo `pausedStepId = stepId` en la base de datos (para indicarle al motor que empiece a ejecutar a partir de ese nodo).
     - Encola la ejecución de forma serializada en el `ProjectQueueManager` de ese proyecto.
     - Al correr, `runExecution` lee el `pausedStepId`, restaura la rama git, y reanuda el bucle `while (currentStep)` a partir de la definición de `stepsMap.get(pausedStepId)`.

---

## 3. Cambios en Detalle

### 3.1 Backend (`server.ts` & `executor.ts`)
* **Endpoint de Rebobinado y Re-ejecución (`POST /api/executions/:id/rewind`):**
  - Carga la ejecución de la colección `executions`.
  - Recupera el snapshot correspondiente a `stepId`.
  - Restaura:
    ```typescript
    execution.stepOutputs = snapshot.stepOutputs;
    execution.currentBranch = snapshot.currentBranch;
    execution.artifacts = snapshot.artifacts;
    execution.variables = snapshot.variables || {};
    ```
  - Elimina de `execution.stepTimings` y `execution.agentMetrics` los registros correspondientes al `stepId` actual y pasos subsiguientes.
  - Setea `execution.pausedStepId = stepId` y `execution.status = 'queued'`.
  - Guarda la ejecución y la añade a la cola del proyecto usando `this.queue.enqueue`.
* **Guardado de Snapshots en `executeNode` (`executor.ts`):**
  - Antes de despachar el paso (`this.dispatchStep`), tomamos una copia profunda del contexto actual (`context.stepOutputs`, `context.currentBranch`, etc.) y la guardamos en `execution.debugSnapshots[step.id]`.
* **Soporte de Entrada en `runExecution`:**
  - Si al iniciar la ejecución, `execution.pausedStepId` está definido, inicializamos el bucle con `currentStep = stepsMap.get(execution.pausedStepId)` en lugar del nodo trigger por defecto.

### 3.2 Frontend (`App.tsx` & Layout)
* **Alto de pantalla completa (`overflow-hidden`):**
  - Ajustamos el contenedor del main en `App.tsx` para usar `overflow-hidden` en las pestañas `executions` y `workflows`.
* **Manejo de resizing (`ExecutionsView.tsx`):**
  - Estados `graphHeight` e `inspectorWidth` sincronizados con `localStorage` (`opencode_debug_graph_height` y `opencode_debug_inspector_width`).
  - Dividores arrastrables con eventos de mouse globales para garantizar un drag suave y sin pérdidas de foco.

### 3.3 Editor de Configuración en Detalle (`StepDetailPanel.tsx`)
* **Pestaña "Config":**
  - Formulario con campos de edición rápida según tipo de paso.
  - Campo de texto/textarea crudo JSON (con validación de estructura) para flexibilidad total.
  - Botón **"Guardar en el Workflow"**: actualiza la definición de pasos en el workflow por API PUT, llamando después a `onFetchData` para sincronizar.
  - Botón **"Re-ejecutar desde este nodo"** (con icono de recarga/play), que gatilla la re-ejecución selectiva.

---

## 4. Contrato de Datos (Shared)

Se expande el tipo `Execution` en `packages/shared/src/types.ts`:
```typescript
export interface ExecutionSnapshot {
  stepOutputs: Record<string, any>;
  currentBranch?: string;
  artifacts: string[];
  variables: Record<string, any>;
}

// Dentro de Execution
export interface Execution {
  // ... campos existentes
  pausedStepId?: string;
  debugSnapshots?: Record<string, ExecutionSnapshot>;
}
```
