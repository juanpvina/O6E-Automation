# OpenCode Orchestrator — Workflow Editor UX & Power Spec

**Estado:** Aprobado en brainstorming (2026-08-21).
**Alcance:** Ampliar la potencia del motor con nodos de primera clase (`http_request` y `code` para JS/Python), implementar un modal de catálogo visual categorizado para agregar nodos, enriquecer el editor gráfico SVG para permitir edición directa sobre el lienzo (inserción en conexiones, eliminación rápida), y corregir el bug de renderizado de loops/ciclos mediante un ordenamiento DFS anclado a la raíz.

---

## 1. Potencia y Nuevas Capacidades (Nodos de Primera Clase)

### 1.1 Modelo de Datos (`packages/shared/src/types.ts`)
*   Se extiende `StepType` para admitir `'http_request'` y `'code'`.
*   Definición de valores por defecto en `DEFAULT_STEP_CONFIGS` (`packages/frontend/src/lib/constants.ts`):
    ```typescript
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
    }
    ```

### 1.2 Ejecutor en Backend (`packages/backend/src/services/executor.ts`)
*   **Caso `'http_request'`:**
    *   Soporta métodos `GET`, `POST`, `PUT`, `DELETE`, `PATCH`.
    *   Resuelve referencias a secretos en las cabeceras (`{{secrets.KEY}}`) y realiza la llamada con timeout de 15s.
    *   Retorna `{ success: true, statusCode: res.status, headers: res.headers, responseBody }` almacenado en `context.stepOutputs[stepId]`.
*   **Caso `'code'`:**
    *   **JavaScript:**
        *   Usa el módulo nativo `vm` de Node.js.
        *   Ejecuta el código en un sandbox seguro mediante `vm.runInNewContext`.
        *   Inyecta el objeto `context` (mapeando `triggerPayload`, `stepOutputs` y `variables`) y un objeto `console` alternativo cuyos `log` escriben en las bitácoras reales de la ejecución (`executor.log`).
        *   Captura el valor de retorno final.
    *   **Python:**
        *   Escribe el script del usuario en un archivo temporal.
        *   Intenta ejecutarlo llamando a `python3` (o `python` si no se encuentra).
        *   Inyecta el contexto en forma de argumento JSON o variable de entorno y lee el resultado deserializado desde `stdout`.
        *   Si falla el spawn (por no estar Python instalado), captura el error de forma segura y lanza un log de error detallado en la consola del paso.

---

## 2. Experiencia de Usuario y Usabilidad (Interactividad)

### 2.1 Catálogo de Pasos en Modal (`StepCatalogModal.tsx`)
*   Reemplazo de la paleta compacta lateral por un botón destacado **"+ Agregar Paso"** en `WorkflowsView.tsx`.
*   Al hacer clic, abre un modal categorizado con bordes brillantes y un look tecnológico:
    *   *Disparadores (Triggers):* Webhook, Cron, Manual.
    *   *Inteligencia Artificial:* Agente OpenCode.
    *   *Código y Datos:* Script de Código (JS/Python), Format Template, Normalizar Payload.
    *   *Integraciones:* HTTP Request, Base de datos NoSQL, Git Commit, GitHub PR.
    *   *Lógica y Control:* Condicional, Parallel, Loop, Wait, Retry, Aprobación Humana.
*   Cada tarjeta describe brevemente lo que hace el paso y muestra un icono representativo de `lucide-react`.

### 2.2 Edición Directa sobre el Grafo SVG (`FlowGraph.tsx`)
*   **Inserción interactiva en conexiones (Splicing):**
    *   En el punto medio de cada líneaBezier (`sx, sy` a `tx, ty`), se dibuja un círculo interactivo `<g className="cursor-pointer">` con un icono `+` y efecto hover de color verde esmeralda.
    *   Al pulsarlo, abre el catálogo de pasos. El paso seleccionado se intercala en la lista de `workflowSteps` (modificando los `nextStepIds` de forma correspondiente).
*   **Acciones Rápidas en la Tarjeta:**
    *   Se dibuja un botón interactivo de eliminar (basura) directamente en el gráfico SVG en la esquina de cada tarjeta para borrar el paso de forma inmediata.
*   **Micro-animaciones Cyberpunk:**
    *   Los nodos en estado `running` muestran un contorno con guiones animados (`stroke-dasharray` con animación CSS `dash` rotatoria).
    *   Las tarjetas reaccionan con transiciones CSS de escala y resplandor al ser seleccionadas o al pasar el cursor.

### 2.3 Asistente de Autocompletado de Variables
*   En las entradas de configuración de texto, se añade un pequeño botón "Insertar Variable" que despliega un dropdown del árbol de contexto (`context.stepOutputs`), facilitando la interpolación de datos sin tener que escribir los nombres de los pasos de memoria.

---

## 3. Corrección Visual de Loops y Ciclos en el Grafo

### 3.1 DFS Anclado a Nodos Raíz
*   Para evitar que las relaciones cíclicas inviertan las jerarquías de las columnas de visualización:
    1.  Se computan los nodos con grado de entrada 0 (los disparadores).
    2.  El DFS de detección de ciclos corre **iniciando estrictamente desde estos nodos de entrada**.
    3.  Cualquier enlace que regrese a un nodo con estado "visitando" se clasifica como `back-edge`.
*   En la renderización, las `back-edges` se omiten del cálculo de relajación del eje X y se dibujan como arcos curvados especiales hacia atrás, de color rosa/púrpura punteado, con una etiqueta flotante de "Loopback". Esto elimina el bug de superposición de columnas.
