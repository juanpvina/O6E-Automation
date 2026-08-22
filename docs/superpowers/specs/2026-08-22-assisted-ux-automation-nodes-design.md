# Spec Técnico — Asistentes UX, Generación de ID Automático y Nuevos Nodos de Automatización (Fase 7)

**Fecha:** 2026-08-22 | **Proyecto:** OpenCode Orchestrator | **Fase:** 7
**Estado:** Aprobado — Listo para implementar

---

## 1. Objetivo
Rediseñar y enriquecer la experiencia de usuario (UX) del constructor de workflows mediante asistentes interactivos inline para cron y zonas horarias, generación de identificadores únicos automáticos y la introducción de nuevos nodos de automatización para Discord y Google Sheets (Excel en la nube), junto con super-herramientas inyectadas para el nodo de código (`code`).

---

## 2. Alcance

### UX & Helpers
*   **Asistente Cron Inline:** Desplegable inline para seleccionar presets comunes y controles numéricos rápidos para minuto y hora, actualizando en tiempo real la expresión cron estándar de 5 campos.
*   **Asistente de Zona Horaria Inline:** Buscador con autocomplete pre-cargado con las zonas horarias estándar de producción.
*   **Unique ID Automático:** Generación automática de IDs descriptivos incrementales sin colisiones al agregar pasos al lienzo.

### Nuevos Nodos
*   **Discord Notifier (`discord_notify`):** Envía notificaciones a canales de Discord usando Webhooks, soportando interpolación de variables y secretos.
*   **Google Sheets (`google_sheets`):** Operaciones de lectura, escritura (append) y sobreescritura (update) en Google Sheets. Utiliza credenciales de Service Account configuradas mediante secretos o variables de entorno.
*   **Code Node Superpowers:** Inyección de utilidades `opencode.db` y `opencode.fetch` en el entorno sandbox del paso `code` de JavaScript, facilitando la interacción directa con bases de datos locales y APIs remotas.
*   **Snippets de Script:** Plantillas de código listas para insertar en el editor lateral.

---

## 3. Especificación Técnica de los Componentes

### 3.1. Unique ID Automático
En `WorkflowsView.tsx`, al agregar o intercalar un paso de tipo `T`, se calcula el ID como:
1. Buscar el número de pasos de tipo `T` existentes.
2. Formular un ID base: `type_N` (ej. `agent_1`).
3. Verificar recursivamente si existe en la lista de pasos actual. Si existe, incrementar `N` hasta encontrar un ID disponible.

### 3.2. Asistente Cron Inline & Zona Horaria
Ubicado en `StepDetailPanel.tsx` para el paso disparador (`trigger`):
*   Se añade un selector de presets:
    *   `Cada minuto` $\rightarrow$ `* * * * *`
    *   `Cada hora` $\rightarrow$ `0 * * * *`
    *   `Diario (9:00 AM)` $\rightarrow$ `0 9 * * *`
    *   `Semanal (Lunes 9:00 AM)` $\rightarrow$ `0 9 * * 1`
    *   `Mensual (Día 1, 9:00 AM)` $\rightarrow$ `0 9 1 * *`
    *   `Personalizado` $\rightarrow$ Muestra selectores inline de horas y minutos.
*   Para Zonas Horarias, un combo desplegable o input de tipo `datalist` con autocompletado nativo HTML5 conteniendo zonas horarias pre-cargadas.

### 3.3. Nuevos Runner en `executor.ts`

#### Discord Notifier (`discord_notify`)
*   **Configuración:** `webhookUrl: string`, `content: string`, `username?: string`, `avatarUrl?: string`.
*   **Ejecución:** Envía un POST request HTTP a `webhookUrl` con el cuerpo `{ content, username, avatar_url }`. Resuelve variables en los campos usando interpolación.

#### Google Sheets (`google_sheets`)
*   **Configuración:** `spreadsheetId: string`, `range: string`, `operation: 'read' | 'append' | 'update'`, `values: string` (JSON string conteniendo matriz bidimensional de datos `[[col1, col2, ...]]`).
*   **Ejecución:**
    1. Resuelve credenciales del archivo JSON de Service Account apuntado por la variable de entorno `GOOGLE_APPLICATION_CREDENTIALS` o mediante el secreto `GOOGLE_SERVICE_ACCOUNT_KEY` (AES decrypt).
    2. Si las credenciales están disponibles, importa `googleapis` de forma dinámica y realiza la llamada a `sheets.spreadsheets.values`.
    3. Si no están configuradas, opera en modo simulado para desarrollo, escribiendo los datos simulados en un JSON local e imprimiendo advertencias en los logs.

#### Inyecciones en Paso de Código (`code` - JavaScript)
*   **Fetch:** Añadir `fetch` nativo al sandbox de `vm.runInNewContext`.
*   **NoSQL Database Helper (`opencode.db`):**
    *   `get(dbId, collection, docId)` $\rightarrow$ Llama de forma síncrona/asíncrona al store del backend para traer los datos.
    *   `set(dbId, collection, docId, data)` $\rightarrow$ Escribe en el store de base de datos de forma directa.

---

## 4. Criterios de Aceptación
*   Se pueden crear workflows vacíos de manera exitosa.
*   Al agregar un paso al lienzo, se genera un ID único descriptivo.
*   El asistente cron inline permite actualizar campos visualmente.
*   Los nuevos runners `discord_notify`, `google_sheets` y las extensiones del nodo `code` corren correctamente y compilan en TypeScript.
*   Todos los paquetes del monorepo compilan sin errores.
